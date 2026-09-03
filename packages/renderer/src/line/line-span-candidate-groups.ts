import {
  mapNormalizedRange,
  sameNormalizedRange,
} from '@transitmapper/core/network/carrier-alignment';
import type { TransitCarrierRef } from '@transitmapper/core/transit/value-types';
import type { LineSpanCandidate, ValidatedLineSpanCandidates } from './line-span-candidates';

export type SameLineCarrierRule = 'shared-alignment' | 'same-physical-carrier';

export type ExactCarrierCandidateRejectionReason =
  | 'line-scope-conflict'
  | 'line-rank-conflict'
  | 'candidate-mapping-conflict'
  | 'duplicate-contributor-conflict';

interface RejectedExactCarrierCandidates {
  readonly kind: 'rejected';
  readonly reason: ExactCarrierCandidateRejectionReason;
  readonly recordId: string;
}

export interface PreparedLineSpanCandidate {
  readonly candidate: LineSpanCandidate;
  readonly recordId: string;
  readonly logicalPatternLegFragmentIds: readonly [string, ...string[]];
  readonly shardIds: readonly [string, ...string[]];
  readonly visibleShardIds: readonly string[];
}

export interface ExactCarrierGroup {
  readonly candidates: readonly [PreparedLineSpanCandidate, ...PreparedLineSpanCandidate[]];
  readonly canonicalCarrier: TransitCarrierRef;
}

interface DeferredPreparedCandidate {
  readonly reason: 'bare-alignment' | 'unresolved-lane';
  readonly prepared: PreparedLineSpanCandidate;
}

export type PreparedExactCarrierGroups =
  | {
      readonly kind: 'ready';
      readonly groups: readonly ExactCarrierGroup[];
      readonly deferred: readonly DeferredPreparedCandidate[];
    }
  | RejectedExactCarrierCandidates;

const textEncoder = new TextEncoder();

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function compareIds(left: string, right: string): number {
  return compareBytes(textEncoder.encode(left), textEncoder.encode(right));
}

function compareOptionalIds(left: string | undefined, right: string | undefined): number {
  if (left === undefined) return right === undefined ? 0 : -1;
  if (right === undefined) return 1;
  return compareIds(left, right);
}

function carrierKindOrder(carrier: TransitCarrierRef): number {
  return carrier.kind === 'way' ? 0 : 1;
}

function compareCarrier(left: TransitCarrierRef, right: TransitCarrierRef): number {
  const kindDifference = carrierKindOrder(left) - carrierKindOrder(right);
  if (kindDifference !== 0) return kindDifference;
  const idDifference = compareIds(left.id, right.id);
  if (idDifference !== 0) return idDifference;
  return compareOptionalIds(
    left.kind === 'way' ? left.laneId : undefined,
    right.kind === 'way' ? right.laneId : undefined,
  );
}

function compareRanges(left: readonly [number, number], right: readonly [number, number]): number {
  const startDifference = left[0] - right[0];
  return startDifference !== 0 ? startDifference : left[1] - right[1];
}

function compareSemanticCandidates(left: LineSpanCandidate, right: LineSpanCandidate): number {
  const rankDifference = left.lineRank - right.lineRank;
  if (rankDifference !== 0) return rankDifference;
  const lineDifference = compareIds(left.lineId, right.lineId);
  if (lineDifference !== 0) return lineDifference;
  const servicePlanDifference = compareIds(left.servicePlanId, right.servicePlanId);
  if (servicePlanDifference !== 0) return servicePlanDifference;
  const patternDifference = compareIds(left.patternId, right.patternId);
  if (patternDifference !== 0) return patternDifference;
  const legDifference = left.legIndex - right.legIndex;
  if (legDifference !== 0) return legDifference;
  const carrierDifference = compareCarrier(left.carrier, right.carrier);
  return carrierDifference !== 0
    ? carrierDifference
    : compareRanges(left.logicalCarrierRange, right.logicalCarrierRange);
}

export function compareLineSpanCandidates(
  left: LineSpanCandidate,
  right: LineSpanCandidate,
): number {
  const semanticDifference = compareSemanticCandidates(left, right);
  return semanticDifference !== 0
    ? semanticDifference
    : compareIds(left.logicalPatternLegFragmentId, right.logicalPatternLegFragmentId);
}

function rejected(
  reason: ExactCarrierCandidateRejectionReason,
  recordId: string,
): RejectedExactCarrierCandidates {
  return { kind: 'rejected', reason, recordId };
}

function lineScopeRejection(
  lineId: string,
  candidates: readonly LineSpanCandidate[],
): RejectedExactCarrierCandidates | undefined {
  const candidate = candidates
    .filter((entry) => entry.lineId !== lineId)
    .sort(compareLineSpanCandidates)
    .at(0);
  return candidate
    ? rejected('line-scope-conflict', candidate.logicalPatternLegFragmentId)
    : undefined;
}

function lineRankRejection(
  lineId: string,
  candidates: readonly LineSpanCandidate[],
): RejectedExactCarrierCandidates | undefined {
  const ranks = new Set(candidates.map(({ lineRank }) => lineRank));
  return ranks.size <= 1 ? undefined : rejected('line-rank-conflict', lineId);
}

function groupCarrier(candidate: LineSpanCandidate, rule: SameLineCarrierRule): TransitCarrierRef {
  return rule === 'shared-alignment'
    ? { kind: 'alignment', id: candidate.alignmentId }
    : candidate.carrier;
}

function compareGroupCandidates(
  left: LineSpanCandidate,
  right: LineSpanCandidate,
  rule: SameLineCarrierRule,
): number {
  const rankDifference = left.lineRank - right.lineRank;
  if (rankDifference !== 0) return rankDifference;
  const lineDifference = compareIds(left.lineId, right.lineId);
  if (lineDifference !== 0) return lineDifference;
  const carrierDifference = compareCarrier(groupCarrier(left, rule), groupCarrier(right, rule));
  return carrierDifference !== 0 ? carrierDifference : compareLineSpanCandidates(left, right);
}

function sameGroup(
  left: PreparedLineSpanCandidate,
  right: PreparedLineSpanCandidate,
  rule: SameLineCarrierRule,
): boolean {
  return (
    left.candidate.lineId === right.candidate.lineId &&
    compareCarrier(groupCarrier(left.candidate, rule), groupCarrier(right.candidate, rule)) === 0
  );
}

function deferralReason(
  candidate: LineSpanCandidate,
  rule: SameLineCarrierRule,
): DeferredPreparedCandidate['reason'] | undefined {
  if (rule !== 'same-physical-carrier') return undefined;
  if (candidate.carrier.kind === 'alignment') return 'bare-alignment';
  return candidate.carrier.laneId === undefined ? 'unresolved-lane' : undefined;
}

function partitionCandidates(
  candidates: readonly PreparedLineSpanCandidate[],
  rule: SameLineCarrierRule,
): Pick<Extract<PreparedExactCarrierGroups, { readonly kind: 'ready' }>, 'groups' | 'deferred'> {
  const ordered = [...candidates].sort((left, right) =>
    compareGroupCandidates(left.candidate, right.candidate, rule),
  );
  const groups: ExactCarrierGroup[] = [];
  const deferred: DeferredPreparedCandidate[] = [];
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && sameGroup(ordered[start], ordered[end], rule)) end += 1;
    const members = ordered.slice(start, end) as [
      PreparedLineSpanCandidate,
      ...PreparedLineSpanCandidate[],
    ];
    if (members.some(({ visibleShardIds }) => visibleShardIds.length > 0)) {
      const candidate = members[0].candidate;
      const reason = deferralReason(candidate, rule);
      if (reason) deferred.push(...members.map((prepared) => ({ reason, prepared })));
      else groups.push({ candidates: members, canonicalCarrier: groupCarrier(candidate, rule) });
    }
    start = end;
  }
  deferred.sort((left, right) =>
    compareLineSpanCandidates(left.prepared.candidate, right.prepared.candidate),
  );
  return { groups, deferred };
}

function sameAlignmentMapping(left: LineSpanCandidate, right: LineSpanCandidate): boolean {
  if (left.alignmentMapping.kind === 'identity') {
    return right.alignmentMapping.kind === 'identity';
  }
  if (right.alignmentMapping.kind === 'identity') return false;
  return sameNormalizedRange(
    left.alignmentMapping.alignmentExtent,
    right.alignmentMapping.alignmentExtent,
  );
}

function duplicateCandidateConflict(left: LineSpanCandidate, right: LineSpanCandidate): boolean {
  return (
    left.direction !== right.direction ||
    left.alignmentId !== right.alignmentId ||
    left.carrierGrade !== right.carrierGrade ||
    left.servicePlanMode.kind !== right.servicePlanMode.kind ||
    (left.servicePlanMode.kind === 'known' &&
      right.servicePlanMode.kind === 'known' &&
      left.servicePlanMode.value !== right.servicePlanMode.value) ||
    !sameAlignmentMapping(left, right)
  );
}

function sortedUniqueIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort(compareIds);
}

function nonemptySortedUniqueIds(ids: readonly string[]): readonly [string, ...string[]] {
  const sorted = sortedUniqueIds(ids);
  return [sorted[0], ...sorted.slice(1)];
}

function normalizeCandidates(
  candidates: readonly LineSpanCandidate[],
):
  | { readonly kind: 'ready'; readonly candidates: readonly PreparedLineSpanCandidate[] }
  | RejectedExactCarrierCandidates {
  const ordered = [...candidates].sort(compareLineSpanCandidates);
  const prepared: PreparedLineSpanCandidate[] = [];
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && compareSemanticCandidates(ordered[start], ordered[end]) === 0) {
      if (duplicateCandidateConflict(ordered[start], ordered[end])) {
        return rejected(
          'duplicate-contributor-conflict',
          ordered[start].logicalPatternLegFragmentId,
        );
      }
      end += 1;
    }
    const duplicates = ordered.slice(start, end);
    prepared.push({
      candidate: ordered[start],
      recordId: ordered[start].logicalPatternLegFragmentId,
      logicalPatternLegFragmentIds: nonemptySortedUniqueIds(
        duplicates.map(({ logicalPatternLegFragmentId }) => logicalPatternLegFragmentId),
      ),
      shardIds: nonemptySortedUniqueIds(duplicates.flatMap(({ shardIds }) => shardIds)),
      visibleShardIds: sortedUniqueIds(
        duplicates.flatMap(({ visibleShardIds }) => visibleShardIds),
      ),
    });
    start = end;
  }
  return { kind: 'ready', candidates: prepared };
}

function invalidCandidateMapping(candidate: LineSpanCandidate): boolean {
  if (candidate.carrier.kind === 'alignment') {
    return candidate.alignmentMapping.kind !== 'identity';
  }
  if (candidate.alignmentMapping.kind !== 'way-affine') return true;
  const [start, end] = candidate.alignmentMapping.alignmentExtent;
  return !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end || end > 1;
}

function candidateMappingRejection(
  candidates: readonly LineSpanCandidate[],
): RejectedExactCarrierCandidates | undefined {
  const candidate = candidates
    .filter(invalidCandidateMapping)
    .sort(compareLineSpanCandidates)
    .at(0);
  return candidate
    ? rejected('candidate-mapping-conflict', candidate.logicalPatternLegFragmentId)
    : undefined;
}

export function lineSpanCandidateRange(
  candidate: LineSpanCandidate,
  rule: SameLineCarrierRule,
): readonly [number, number] {
  if (rule === 'same-physical-carrier') return candidate.logicalCarrierRange;
  return candidate.alignmentMapping.kind === 'identity'
    ? candidate.logicalCarrierRange
    : mapNormalizedRange(
        candidate.logicalCarrierRange,
        [0, 1],
        candidate.alignmentMapping.alignmentExtent,
      );
}

export function prepareExactCarrierGroups(
  lineId: string,
  candidates: ValidatedLineSpanCandidates,
  carrierRule: SameLineCarrierRule,
): PreparedExactCarrierGroups {
  const scopeConflict = lineScopeRejection(lineId, candidates);
  if (scopeConflict) return scopeConflict;
  const rankConflict = lineRankRejection(lineId, candidates);
  if (rankConflict) return rankConflict;
  const mappingConflict = candidateMappingRejection(candidates);
  if (mappingConflict) return mappingConflict;
  const normalized = normalizeCandidates(candidates);
  if (normalized.kind === 'rejected') return normalized;
  const { groups, deferred } = partitionCandidates(normalized.candidates, carrierRule);
  return { kind: 'ready', groups, deferred };
}
