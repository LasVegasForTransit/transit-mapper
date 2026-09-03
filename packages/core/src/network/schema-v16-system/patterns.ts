import type { GeographicBounds, LngLat } from '../../geography/bounds';
import { slicePathByT } from '../../model/geo/measurement';
import { legRange, patternRunLegs, serviceWayIds } from '../../model/geo/servicePaths';
import { resolveWayPath } from '../../model/geo/wayPath';
import type { PatternLeg, RunDirection, Service, Stop, Way } from '../../model/system';
import type { LegDirection as ResolvedLegDirection } from '../../transit/value-types';
import type { ResolvedPatternStopCall } from '../resolved-network-chunk';
import { pathIntersectsBounds, validCoordinate } from './bounds';
import { legacyDerivedId } from './identity';

interface RunLegContext {
  legacyLegIndex: number;
  leg: PatternLeg;
  legIndex: number;
  direction: ResolvedLegDirection;
  range: readonly [number, number];
  way: Way;
}

export interface DerivedCall extends ResolvedPatternStopCall {
  pathAnchor: { legIndex: number; carrierPosition: number };
  pathOrder: number;
}

export interface DerivedLegFragment {
  id: string;
  patternId: string;
  legIndex: number;
  carrierRange: readonly [number, number];
  direction: ResolvedLegDirection;
  pathOrderStart: number;
  pathOrderEnd: number;
  way: Way;
  laneId?: string;
}

export interface DerivedPattern {
  patternId: string;
  service: Service;
  run: RunDirection;
  path: 'known' | 'unknown';
  calls: DerivedCall[];
  fragments: DerivedLegFragment[];
}

interface CallCandidate {
  stop: Stop;
  stopIndex: number;
  anchorIndex: number;
  legIndex: number;
  carrierPosition: number;
}

interface DeriveCallsInput {
  service: Service;
  run: RunDirection;
  patternId: string;
  contexts: readonly RunLegContext[];
  stopsByWayId: ReadonlyMap<string, readonly Stop[]>;
}

interface DeriveFragmentsInput {
  service: Service;
  run: RunDirection;
  patternId: string;
  contexts: readonly RunLegContext[];
  calls: readonly DerivedCall[];
}

interface FragmentPieceInput {
  derivation: DeriveFragmentsInput;
  context: RunLegContext;
  pieceIndex: number;
  range: readonly [number, number];
}

export function wayToServiceIndex(
  services: readonly Service[],
): ReadonlyMap<string, readonly Service[]> {
  const index = new Map<string, Service[]>();
  for (const service of services) {
    for (const wayId of serviceWayIds(service)) {
      const entries = index.get(wayId);
      if (entries) entries.push(service);
      else index.set(wayId, [service]);
    }
  }
  return index;
}

export function wayToStopIndex(stops: readonly Stop[]): ReadonlyMap<string, readonly Stop[]> {
  const index = new Map<string, Stop[]>();
  for (const stop of stops) {
    for (const wayId of new Set(stop.anchors.map(({ wayId }) => wayId))) {
      const entries = index.get(wayId);
      if (entries) entries.push(stop);
      else index.set(wayId, [stop]);
    }
  }
  return index;
}

function validWayGeometry(way: Way): boolean {
  return way.points.length >= 2 && way.points.every(validCoordinate);
}

function validLegRange(leg: PatternLeg): boolean {
  if (leg.extent.kind === 'whole') return true;
  const { fromT, toT } = leg.extent;
  return (
    Number.isFinite(fromT) &&
    Number.isFinite(toT) &&
    fromT >= 0 &&
    fromT <= 1 &&
    toT >= 0 &&
    toT <= 1 &&
    fromT !== toT
  );
}

function validPinnedLane(way: Way, leg: PatternLeg): boolean {
  if (leg.lane.kind === 'auto') return true;
  const laneId = leg.lane.laneId;
  return way.profile.lanes.some((lane) => lane.id === laneId);
}

function runLegContexts(
  service: Service,
  run: RunDirection,
  waysById: ReadonlyMap<string, Way>,
): RunLegContext[] | null {
  const runLegs = patternRunLegs(service.path, run);
  const contexts: RunLegContext[] = [];
  for (let legIndex = 0; legIndex < runLegs.length; legIndex += 1) {
    const runLeg = runLegs[legIndex];
    const way = waysById.get(runLeg.leg.wayId);
    if (!way || !validWayGeometry(way) || !validLegRange(runLeg.leg)) return null;
    if (!validPinnedLane(way, runLeg.leg)) return null;
    contexts.push({
      legacyLegIndex: runLeg.index,
      leg: runLeg.leg,
      legIndex,
      direction: runLeg.forward ? 'forward' : 'reverse',
      range: legRange(runLeg.leg),
      way,
    });
  }
  return contexts;
}

function positionProgress(context: RunLegContext, position: number): number {
  const [start, end] = context.range;
  return context.direction === 'forward'
    ? (position - start) / (end - start)
    : (end - position) / (end - start);
}

function selectedAnchor(
  stop: Stop,
  context: RunLegContext,
): { anchorIndex: number; carrierPosition: number } | undefined {
  const anchors = stop.anchors.flatMap((anchor, anchorIndex) =>
    anchor.wayId === context.leg.wayId &&
    Number.isFinite(anchor.t) &&
    anchor.t >= context.range[0] &&
    anchor.t <= context.range[1]
      ? [{ anchorIndex, carrierPosition: anchor.t }]
      : [],
  );
  anchors.sort((left, right) => {
    const byTravel =
      context.direction === 'forward'
        ? left.carrierPosition - right.carrierPosition
        : right.carrierPosition - left.carrierPosition;
    return byTravel || left.anchorIndex - right.anchorIndex;
  });
  return anchors[0];
}

function candidatesForLeg(
  stops: readonly Stop[],
  skipped: ReadonlySet<string>,
  context: RunLegContext,
): CallCandidate[] {
  const candidates = stops.flatMap((stop, stopIndex) => {
    if (skipped.has(stop.id)) return [];
    const anchor = selectedAnchor(stop, context);
    return anchor
      ? [{ stop, stopIndex, legIndex: context.legIndex, ...anchor } satisfies CallCandidate]
      : [];
  });
  candidates.sort((left, right) => {
    const byTravel =
      context.direction === 'forward'
        ? left.carrierPosition - right.carrierPosition
        : right.carrierPosition - left.carrierPosition;
    return byTravel || left.stopIndex - right.stopIndex || left.anchorIndex - right.anchorIndex;
  });
  return candidates;
}

function sameBoundaryCall(
  previous: CallCandidate,
  current: CallCandidate,
  contexts: readonly RunLegContext[],
): boolean {
  if (previous.stop.id !== current.stop.id || current.legIndex !== previous.legIndex + 1) {
    return false;
  }
  const previousLeg = contexts[previous.legIndex];
  const currentLeg = contexts[current.legIndex];
  const previousEnd =
    previousLeg.direction === 'forward' ? previousLeg.range[1] : previousLeg.range[0];
  const currentStart =
    currentLeg.direction === 'forward' ? currentLeg.range[0] : currentLeg.range[1];
  return previous.carrierPosition === previousEnd && current.carrierPosition === currentStart;
}

function collapseBoundaryCalls(
  ordered: readonly CallCandidate[],
  contexts: readonly RunLegContext[],
): CallCandidate[] {
  const collapsed: CallCandidate[] = [];
  for (const candidate of ordered) {
    const previous = collapsed.at(-1);
    if (!previous || !sameBoundaryCall(previous, candidate, contexts)) collapsed.push(candidate);
  }
  return collapsed;
}

function deriveCalls(input: DeriveCallsInput): DerivedCall[] {
  const skipped = new Set(input.service.path.skippedStops?.[input.run] ?? []);
  const ordered = input.contexts.flatMap((context) =>
    candidatesForLeg(input.stopsByWayId.get(context.way.id) ?? [], skipped, context),
  );
  const candidates = collapseBoundaryCalls(ordered, input.contexts);
  return candidates.map((candidate, sequence) => {
    const context = input.contexts[candidate.legIndex];
    return {
      id: legacyDerivedId('stop-call', input.service.id, input.run, sequence, candidate.stop.id),
      patternId: input.patternId,
      stopId: candidate.stop.id,
      sequence,
      service: 'served',
      pathAnchor: {
        legIndex: candidate.legIndex,
        carrierPosition: candidate.carrierPosition,
      },
      pathOrder: candidate.legIndex + positionProgress(context, candidate.carrierPosition),
    };
  });
}

function splitPositions(context: RunLegContext, calls: readonly DerivedCall[]): number[] {
  const positions = new Set<number>(context.range);
  for (const call of calls) {
    if (call.pathAnchor.legIndex === context.legIndex) {
      positions.add(call.pathAnchor.carrierPosition);
    }
  }
  return [...positions].sort((left, right) => left - right);
}

function fragmentPiece(input: FragmentPieceInput): DerivedLegFragment {
  const { context, pieceIndex } = input;
  const [start, end] = input.range;
  const laneId = context.leg.lane.kind === 'pinned' ? context.leg.lane.laneId : undefined;
  const travelStart = context.direction === 'forward' ? start : end;
  const travelEnd = context.direction === 'forward' ? end : start;
  return {
    id: legacyDerivedId(
      'pattern-leg-fragment',
      input.derivation.service.id,
      input.derivation.run,
      context.legacyLegIndex,
      context.legIndex,
      pieceIndex,
    ),
    patternId: input.derivation.patternId,
    legIndex: context.legIndex,
    carrierRange: [start, end],
    direction: context.direction,
    pathOrderStart: context.legIndex + positionProgress(context, travelStart),
    pathOrderEnd: context.legIndex + positionProgress(context, travelEnd),
    way: context.way,
    ...(laneId === undefined ? {} : { laneId }),
  };
}

function fragmentsForLeg(
  input: DeriveFragmentsInput,
  context: RunLegContext,
): DerivedLegFragment[] {
  const positions = splitPositions(context, input.calls);
  const pieces = positions.slice(0, -1).flatMap((start, pieceIndex) => {
    const end = positions[pieceIndex + 1];
    return end > start
      ? [fragmentPiece({ derivation: input, context, pieceIndex, range: [start, end] })]
      : [];
  });
  return context.direction === 'forward' ? pieces : pieces.reverse();
}

function deriveLegFragments(input: DeriveFragmentsInput): DerivedLegFragment[] {
  return input.contexts.flatMap((context) => fragmentsForLeg(input, context));
}

export function derivePattern(
  service: Service,
  run: RunDirection,
  waysById: ReadonlyMap<string, Way>,
  stopsByWayId: ReadonlyMap<string, readonly Stop[]>,
): DerivedPattern | null {
  const patternId = legacyDerivedId('pattern', service.id, run);
  const contexts = runLegContexts(service, run, waysById);
  if (contexts?.length === 0 && run === 'inbound') return null;
  if (contexts === null || contexts.length === 0) {
    return { patternId, service, run, path: 'unknown', calls: [], fragments: [] };
  }
  const calls = deriveCalls({ service, run, patternId, contexts, stopsByWayId });
  return {
    patternId,
    service,
    run,
    path: 'known',
    calls,
    fragments: deriveLegFragments({ service, run, patternId, contexts, calls }),
  };
}

export function fragmentIntersectsBounds(
  fragment: DerivedLegFragment,
  bounds: GeographicBounds,
): boolean {
  const path = slicePathByT(
    resolveWayPath(fragment.way),
    fragment.carrierRange[0],
    fragment.carrierRange[1],
  ) as LngLat[];
  return pathIntersectsBounds(path, bounds);
}
