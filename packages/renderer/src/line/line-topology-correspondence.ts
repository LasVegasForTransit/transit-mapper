import type { LngLat } from '@transitmapper/core/geography/bounds';
import type { TransitEntityKey } from '@transitmapper/core/model/transit-entity-ref';
import type { Grade, KnownOrUnknown } from '@transitmapper/core/transit/value-types';
import type { ResolvedNetworkProjection } from '../network/resolved-network-projection';
import type { LineMaterialization } from './exact-line-correspondence';
import { enumerateTopologyAnchorMatches } from './line-topology-anchors';
import { createTopologyCandidateComparison, type TopologyMetricPath } from './line-overlap';
import type { LineSpanCandidate, PreparedLineSpanCandidateContext } from './line-span-candidates';
import type { LineSpan } from './line-span-types';
import { prepareTopologyWindow } from './line-topology-windows';
import type {
  PreparedTopologyWindow,
  PreparedTopologyWindowCall,
  TopologyWindowRejectionReason,
} from './line-topology-window-types';

export interface TopologyLineCorrespondence {
  readonly topologyWindowIds: readonly [string, string];
  readonly startAnchorKey: TransitEntityKey;
  readonly endAnchorKey: TransitEntityKey;
  readonly members: readonly [LineSpan, LineSpan, ...LineSpan[]];
}

export type TopologyLineCorrespondenceRejectionReason =
  | TopologyWindowRejectionReason
  | 'topology-line-membership-conflict'
  | 'topology-missing-line-materialization'
  | 'topology-grade-conflict'
  | 'topology-mode-conflict';

export type TopologyLineCorrespondenceResult =
  | { readonly kind: 'ready'; readonly correspondences: readonly TopologyLineCorrespondence[] }
  | { readonly kind: 'pending'; readonly reason: 'more-pages' }
  | {
      readonly kind: 'rejected';
      readonly reason: TopologyLineCorrespondenceRejectionReason;
      readonly recordId: string;
    };

export interface DeriveTopologyLineCorrespondenceOptions {
  readonly projection: ResolvedNetworkProjection;
  readonly context: PreparedLineSpanCandidateContext;
  readonly materializations: readonly LineMaterialization[];
  readonly excludedSpanIds?: ReadonlySet<string>;
}

interface PreparedTopologyLine {
  readonly window: PreparedTopologyWindow;
  readonly lineId: string;
  readonly lineRank: number;
  readonly candidates: readonly LineSpanCandidate[];
  readonly spans: readonly LineSpan[];
}

type PreparedTopologyLinesResult =
  | { readonly kind: 'ready'; readonly lines: readonly PreparedTopologyLine[] }
  | Exclude<TopologyLineCorrespondenceResult, { readonly kind: 'ready' }>;

type TopologyLinePairResult =
  | { readonly kind: 'ready'; readonly correspondences: readonly TopologyLineCorrespondence[] }
  | RejectedTopologyLineCorrespondence;

interface TopologyInterval {
  readonly leftStart: PreparedTopologyWindowCall;
  readonly leftEnd: PreparedTopologyWindowCall;
  readonly rightStart: PreparedTopologyWindowCall;
  readonly rightEnd: PreparedTopologyWindowCall;
  readonly startAnchorKey: TransitEntityKey;
  readonly endAnchorKey: TransitEntityKey;
}

type RejectedTopologyLineCorrespondence = Extract<
  TopologyLineCorrespondenceResult,
  { readonly kind: 'rejected' }
>;

const topologyOperationBudget = 128;
const textEncoder = new TextEncoder();

function compareText(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function rejected(
  reason: TopologyLineCorrespondenceRejectionReason,
  recordId: string,
): RejectedTopologyLineCorrespondence {
  return { kind: 'rejected', reason, recordId };
}

function lineRankById(context: PreparedLineSpanCandidateContext): ReadonlyMap<string, number> {
  return new Map(context.lineIds.map((lineId, rank) => [lineId, rank]));
}

function candidatesForPattern(
  context: PreparedLineSpanCandidateContext,
  patternId: string,
): readonly LineSpanCandidate[] {
  return context.lineIds.flatMap((lineId) =>
    (context.candidatesByLineId.get(lineId) ?? []).filter(
      (candidate) => candidate.patternId === patternId,
    ),
  );
}

function topologyLine(
  window: PreparedTopologyWindow,
  context: PreparedLineSpanCandidateContext,
  materializationsByLineId: ReadonlyMap<string, LineMaterialization>,
  ranks: ReadonlyMap<string, number>,
): PreparedTopologyLine | RejectedTopologyLineCorrespondence {
  const candidates = candidatesForPattern(context, window.patternId);
  const lineIds = [...new Set(candidates.map(({ lineId }) => lineId))];
  if (lineIds.length !== 1) return rejected('topology-line-membership-conflict', window.id);
  const lineId = lineIds[0];
  const materialization = materializationsByLineId.get(lineId);
  if (materialization === undefined)
    return rejected('topology-missing-line-materialization', lineId);
  const lineRank = ranks.get(lineId);
  if (lineRank === undefined) return rejected('topology-line-membership-conflict', lineId);
  return { window, lineId, lineRank, candidates, spans: materialization.spans };
}

function prepareTopologyLines(
  options: DeriveTopologyLineCorrespondenceOptions,
  materializationsByLineId: ReadonlyMap<string, LineMaterialization>,
  ranks: ReadonlyMap<string, number>,
): PreparedTopologyLinesResult {
  const lines: PreparedTopologyLine[] = [];
  for (const windowId of [...options.projection.index.topologyWindowsById.keys()].sort(
    compareText,
  )) {
    const prepared = prepareTopologyWindow(
      options.projection,
      options.context.patternLegIndex,
      windowId,
    );
    if (prepared.kind !== 'ready') return prepared;
    const line = topologyLine(prepared.window, options.context, materializationsByLineId, ranks);
    if ('kind' in line) return line;
    lines.push(line);
  }
  lines.sort((left, right) =>
    left.lineRank === right.lineRank
      ? compareText(left.window.id, right.window.id)
      : left.lineRank - right.lineRank,
  );
  return { kind: 'ready', lines };
}

function intervalsFor(
  left: PreparedTopologyLine,
  right: PreparedTopologyLine,
): readonly TopologyInterval[] {
  const matches = enumerateTopologyAnchorMatches(
    left.window.anchoredCalls,
    right.window.anchoredCalls,
  );
  const intervals: TopologyInterval[] = [];
  for (const start of matches) {
    for (const end of matches) {
      if (start.leftCallIndex >= end.leftCallIndex || start.rightCallIndex === end.rightCallIndex)
        continue;
      const leftStart = left.window.anchoredCalls[start.leftCallIndex];
      const leftEnd = left.window.anchoredCalls[end.leftCallIndex];
      const rightStart = right.window.anchoredCalls[start.rightCallIndex];
      const rightEnd = right.window.anchoredCalls[end.rightCallIndex];
      intervals.push({
        leftStart,
        leftEnd,
        rightStart,
        rightEnd,
        startAnchorKey: start.match.anchorKey,
        endAnchorKey: end.match.anchorKey,
      });
    }
  }
  return intervals;
}

function fragmentPoints(
  window: PreparedTopologyWindow,
  start: PreparedTopologyWindowCall,
  end: PreparedTopologyWindowCall,
): readonly [LngLat, LngLat, ...LngLat[]] | undefined {
  const backwards = start.patternLegBoundaryIndex > end.patternLegBoundaryIndex;
  const startBoundary = Math.min(start.patternLegBoundaryIndex, end.patternLegBoundaryIndex);
  const endBoundary = Math.max(start.patternLegBoundaryIndex, end.patternLegBoundaryIndex);
  const fragments = window.fragments.slice(startBoundary, endBoundary);
  const orderedFragments = backwards ? [...fragments].reverse() : fragments;
  const points: LngLat[] = [];
  for (const fragment of orderedFragments) {
    const travelPoints =
      fragment.patternLeg.logical.direction === 'forward'
        ? fragment.shard.carrier.points
        : [...fragment.shard.carrier.points].reverse();
    const directedPoints = backwards ? [...travelPoints].reverse() : travelPoints;
    for (const point of directedPoints) points.push(point);
  }
  if (points.length < 2) return undefined;
  return [points[0], points[1], ...points.slice(2)];
}

function pathFor(
  line: PreparedTopologyLine,
  start: PreparedTopologyWindowCall,
  end: PreparedTopologyWindowCall,
  anchors: Pick<TopologyInterval, 'startAnchorKey' | 'endAnchorKey'>,
): TopologyMetricPath | undefined {
  const points = fragmentPoints(line.window, start, end);
  if (points === undefined) return undefined;
  return {
    identityOrderKey: textEncoder.encode(
      JSON.stringify([line.window.id, start.stopCallId, end.stopCallId]),
    ),
    startAnchorKey: anchors.startAnchorKey,
    endAnchorKey: anchors.endAnchorKey,
    points,
  };
}

function knownValues<T>(
  candidates: readonly LineSpanCandidate[],
  select: (candidate: LineSpanCandidate) => KnownOrUnknown<T> | Grade | undefined,
): ReadonlySet<T | Grade> {
  const values = new Set<T | Grade>();
  for (const candidate of candidates) {
    const value = select(candidate);
    if (value === undefined) continue;
    if (typeof value === 'object') {
      if (value.kind === 'known') values.add(value.value);
    } else values.add(value);
  }
  return values;
}

function hasKnownGradeConflict(
  left: readonly LineSpanCandidate[],
  right: readonly LineSpanCandidate[],
): boolean {
  const leftGrades = knownValues(left, ({ carrierGrade }) => carrierGrade);
  const rightGrades = knownValues(right, ({ carrierGrade }) => carrierGrade);
  return (
    leftGrades.size > 0 &&
    rightGrades.size > 0 &&
    [...leftGrades].some((leftGrade) =>
      [...rightGrades].some((rightGrade) => leftGrade !== rightGrade),
    )
  );
}

function hasSharedKnownMode(
  left: readonly LineSpanCandidate[],
  right: readonly LineSpanCandidate[],
): boolean {
  const leftModes = knownValues(left, ({ servicePlanMode }) => servicePlanMode);
  const rightModes = knownValues(right, ({ servicePlanMode }) => servicePlanMode);
  return [...leftModes].some((mode) => rightModes.has(mode));
}

function spansForInterval(
  line: PreparedTopologyLine,
  start: PreparedTopologyWindowCall,
  end: PreparedTopologyWindowCall,
): readonly LineSpan[] {
  const startBoundary = Math.min(start.patternLegBoundaryIndex, end.patternLegBoundaryIndex);
  const endBoundary = Math.max(start.patternLegBoundaryIndex, end.patternLegBoundaryIndex);
  const legIndexes = new Set(
    line.window.fragments
      .slice(startBoundary, endBoundary)
      .map(({ patternLeg }) => patternLeg.logical.legIndex),
  );
  return line.spans.filter((span) =>
    span.contributors.some(
      ({ patternId, legIndex }) => patternId === line.window.patternId && legIndexes.has(legIndex),
    ),
  );
}

function orderedMembers(
  left: readonly LineSpan[],
  right: readonly LineSpan[],
  leftLine: PreparedTopologyLine,
  rightLine: PreparedTopologyLine,
): readonly [LineSpan, LineSpan, ...LineSpan[]] | undefined {
  const members = [...left, ...right].sort((first, second) => {
    const firstRank = first.lineId === leftLine.lineId ? leftLine.lineRank : rightLine.lineRank;
    const secondRank = second.lineId === leftLine.lineId ? leftLine.lineRank : rightLine.lineRank;
    return firstRank === secondRank ? compareText(first.id, second.id) : firstRank - secondRank;
  });
  if (members.length < 2) return undefined;
  return [members[0], members[1], ...members.slice(2)];
}

async function acceptedTopologyCandidate(
  left: PreparedTopologyLine,
  right: PreparedTopologyLine,
  interval: TopologyInterval,
  excludedSpanIds: ReadonlySet<string>,
): Promise<TopologyLineCorrespondence | RejectedTopologyLineCorrespondence | undefined> {
  if (hasKnownGradeConflict(left.candidates, right.candidates))
    return rejected('topology-grade-conflict', right.window.id);
  if (!hasSharedKnownMode(left.candidates, right.candidates))
    return rejected('topology-mode-conflict', right.window.id);
  const leftPath = pathFor(left, interval.leftStart, interval.leftEnd, interval);
  const rightPath = pathFor(right, interval.rightStart, interval.rightEnd, interval);
  if (leftPath === undefined || rightPath === undefined) return undefined;
  const comparison = createTopologyCandidateComparison({ left: leftPath, right: rightPath });
  let outcome = comparison.advance(topologyOperationBudget);
  while (outcome.kind === 'pending') {
    await Promise.resolve();
    outcome = comparison.advance(topologyOperationBudget);
  }
  if (outcome.kind !== 'accepted') return undefined;
  const members = orderedMembers(
    spansForInterval(left, interval.leftStart, interval.leftEnd),
    spansForInterval(right, interval.rightStart, interval.rightEnd),
    left,
    right,
  );
  if (members === undefined || members.some(({ id }) => excludedSpanIds.has(id))) return undefined;
  return {
    topologyWindowIds: [left.window.id, right.window.id],
    startAnchorKey: interval.startAnchorKey,
    endAnchorKey: interval.endAnchorKey,
    members,
  };
}

function topologyCorrespondenceKey(correspondence: TopologyLineCorrespondence): string {
  return JSON.stringify({
    topologyWindowIds: correspondence.topologyWindowIds,
    startAnchorKey: correspondence.startAnchorKey,
    endAnchorKey: correspondence.endAnchorKey,
    members: correspondence.members.map(({ id }) => id),
  });
}

async function correspondencesForTopologyLinePair(
  left: PreparedTopologyLine,
  right: PreparedTopologyLine,
  excludedSpanIds: ReadonlySet<string>,
): Promise<TopologyLinePairResult> {
  const correspondences: TopologyLineCorrespondence[] = [];
  for (const interval of intervalsFor(left, right)) {
    const correspondence = await acceptedTopologyCandidate(left, right, interval, excludedSpanIds);
    if (correspondence === undefined) continue;
    if ('kind' in correspondence) return correspondence;
    correspondences.push(correspondence);
  }
  return { kind: 'ready', correspondences };
}

async function collectTopologyCorrespondences(
  lines: readonly PreparedTopologyLine[],
  excludedSpanIds: ReadonlySet<string>,
): Promise<TopologyLineCorrespondenceResult> {
  const correspondenceByKey = new Map<string, TopologyLineCorrespondence>();
  for (const [leftIndex, left] of lines.entries()) {
    for (const right of lines.slice(leftIndex + 1)) {
      if (left.lineId === right.lineId) continue;
      const result = await correspondencesForTopologyLinePair(left, right, excludedSpanIds);
      if (result.kind === 'rejected') return result;
      for (const correspondence of result.correspondences)
        correspondenceByKey.set(topologyCorrespondenceKey(correspondence), correspondence);
    }
  }
  return { kind: 'ready', correspondences: [...correspondenceByKey.values()] };
}

/**
 * Uses complete validated topology windows and authored anchors only. Visible
 * source fragments never participate in cross-Line correspondence.
 */
export async function deriveTopologyLineCorrespondence(
  options: DeriveTopologyLineCorrespondenceOptions,
): Promise<TopologyLineCorrespondenceResult> {
  const materializationsByLineId = new Map(
    options.materializations.map((materialization) => [materialization.lineId, materialization]),
  );
  const ranks = lineRankById(options.context);
  const prepared = prepareTopologyLines(options, materializationsByLineId, ranks);
  if (prepared.kind !== 'ready') return prepared;
  return collectTopologyCorrespondences(prepared.lines, options.excludedSpanIds ?? new Set());
}
