import type {
  Grade,
  KnownOrUnknown,
  LegDirection,
  TransitCarrierRef,
} from '@transitmapper/core/transit/value-types';
import type { ResolvedNetworkProjection } from '../network/resolved-network-projection';
import {
  prepareLineSpanInput,
  type PreparedLineSpanInput,
  type PrepareLineSpanInputResult,
} from './line-spans';
import {
  preparePatternLegIndex,
  type PatternLegAlignmentMapping,
  type PatternLegRejectionReason,
  type PreparedPatternLeg,
  type PreparedPatternLegIndex,
} from './pattern-leg-index';

export type CandidateCarrierAlignmentMapping = PatternLegAlignmentMapping;

export interface LineSpanCandidate {
  readonly lineId: string;
  readonly lineRank: number;
  readonly servicePlanId: string;
  readonly servicePlanMode: KnownOrUnknown<string>;
  readonly patternId: string;
  readonly legIndex: number;
  readonly direction: LegDirection;
  readonly logicalPatternLegFragmentId: string;
  readonly carrier: TransitCarrierRef;
  /** `undefined` means the carrier is an Alignment with no physical-grade fact. */
  readonly carrierGrade: Grade | undefined;
  readonly alignmentId: string;
  readonly alignmentMapping: CandidateCarrierAlignmentMapping;
  readonly logicalCarrierRange: readonly [number, number];
  readonly shardIds: readonly [string, ...string[]];
  readonly visibleShardIds: readonly string[];
}

declare const validatedLineSpanCandidatesBrand: unique symbol;

/**
 * Candidate preparation owns the source-result checks that make exact carrier
 * grouping safe. The brand prevents production callers from skipping them by
 * passing structural candidate data straight into that stage.
 */
export type ValidatedLineSpanCandidates = readonly LineSpanCandidate[] & {
  readonly [validatedLineSpanCandidatesBrand]: 'validated-line-span-candidates';
};

export interface PreparedLineSpanCandidateContext {
  readonly input: PreparedLineSpanInput;
  readonly patternLegIndex: PreparedPatternLegIndex;
  /** Dataset rank order is the only order that schedules Line materialization. */
  readonly lineIds: readonly string[];
  readonly candidatesByLineId: ReadonlyMap<string, ValidatedLineSpanCandidates>;
}

type InputRejectionReason = Extract<
  PrepareLineSpanInputResult,
  { readonly kind: 'rejected' }
>['reason'];

type CandidateRejectionReason =
  | InputRejectionReason
  | 'missing-line-membership'
  | 'ambiguous-line-membership'
  | 'missing-line'
  | 'missing-service-plan'
  | 'missing-pattern'
  | 'unknown-pattern-path'
  | 'missing-line-order'
  | 'invalid-line-order'
  | PatternLegRejectionReason;

export type PrepareLineSpanCandidateContextResult =
  | {
      readonly kind: 'ready';
      readonly context: PreparedLineSpanCandidateContext;
      readonly lineIds: readonly string[];
    }
  | { readonly kind: 'pending'; readonly reason: 'more-pages' }
  | {
      readonly kind: 'rejected';
      readonly reason: CandidateRejectionReason;
      readonly recordId: string;
    };

export type PrepareLineSpanCandidatesResult =
  | {
      readonly kind: 'ready';
      readonly candidates: ValidatedLineSpanCandidates;
      readonly context: PreparedLineSpanCandidateContext;
    }
  | Exclude<PrepareLineSpanCandidateContextResult, { readonly kind: 'ready' }>;

type CandidateRejection = Extract<
  PrepareLineSpanCandidateContextResult,
  { readonly kind: 'rejected' }
>;

interface PreparedLineOrder {
  readonly lineIds: readonly string[];
  readonly rankByLineId: ReadonlyMap<string, number>;
}

type PreparedLineOrderResult =
  { readonly kind: 'ready'; readonly order: PreparedLineOrder } | CandidateRejection;

const textEncoder = new TextEncoder();

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function bytesFor(id: string, cache: Map<string, Uint8Array>): Uint8Array {
  const existing = cache.get(id);
  if (existing !== undefined) return existing;
  const encoded = textEncoder.encode(id);
  cache.set(id, encoded);
  return encoded;
}

function compareIds(left: string, right: string, cache: Map<string, Uint8Array>): number {
  return compareBytes(bytesFor(left, cache), bytesFor(right, cache));
}

function rejected(reason: CandidateRejectionReason, recordId: string): CandidateRejection {
  return { kind: 'rejected', reason, recordId };
}

function firstLineIdAfterRank(
  lineIdByRank: ReadonlyMap<number, string>,
  rank: number,
): string | undefined {
  let nextRank = Number.POSITIVE_INFINITY;
  let lineId: string | undefined;
  for (const [candidateRank, candidateLineId] of lineIdByRank) {
    if (candidateRank > rank && candidateRank < nextRank) {
      nextRank = candidateRank;
      lineId = candidateLineId;
    }
  }
  return lineId;
}

function prepareLineOrder(
  projection: ResolvedNetworkProjection,
  idByteCache: Map<string, Uint8Array>,
): PreparedLineOrderResult {
  const rankByLineId = new Map<string, number>();
  const lineIdByRank = new Map<number, string>();
  for (const entry of projection.result.lineOrder) {
    if (!Number.isSafeInteger(entry.rank) || entry.rank < 0 || rankByLineId.has(entry.lineId)) {
      return rejected('invalid-line-order', entry.lineId);
    }
    const rankOwner = lineIdByRank.get(entry.rank);
    if (rankOwner !== undefined) {
      const recordId =
        compareIds(rankOwner, entry.lineId, idByteCache) <= 0 ? rankOwner : entry.lineId;
      return rejected('invalid-line-order', recordId);
    }
    rankByLineId.set(entry.lineId, entry.rank);
    lineIdByRank.set(entry.rank, entry.lineId);
  }
  for (let rank = 0; rank < lineIdByRank.size; rank += 1) {
    if (lineIdByRank.has(rank)) continue;
    const lineId = firstLineIdAfterRank(lineIdByRank, rank);
    if (lineId !== undefined) return rejected('invalid-line-order', lineId);
  }
  return {
    kind: 'ready',
    order: {
      lineIds: Array.from({ length: lineIdByRank.size }, (_, rank) => {
        const lineId = lineIdByRank.get(rank);
        if (lineId === undefined) throw new Error('Validated Line rank is missing.');
        return lineId;
      }),
      rankByLineId,
    },
  };
}

interface LineMembership {
  readonly lineId: string;
  readonly servicePlans: readonly LineServicePlanMembership[];
}

interface LineServicePlanMembership {
  readonly servicePlanId: string;
  readonly mode: KnownOrUnknown<string>;
}

function lineMembership(
  projection: ResolvedNetworkProjection,
  patternId: string,
  idByteCache: Map<string, Uint8Array>,
): LineMembership | CandidateRejection {
  const memberships = projection.index.linePatternsByPatternId.get(patternId) ?? [];
  const lineIds = new Set(memberships.map(({ lineId }) => lineId));
  if (lineIds.size === 0) return rejected('missing-line-membership', patternId);
  if (lineIds.size !== 1) return rejected('ambiguous-line-membership', patternId);
  const lineId = [...lineIds][0];
  if (!projection.index.linesById.has(lineId)) return rejected('missing-line', lineId);
  const servicePlanIds = [
    ...new Set(
      memberships
        .filter((membership) => membership.lineId === lineId)
        .map(({ servicePlanId }) => servicePlanId),
    ),
  ].sort((left, right) => compareIds(left, right, idByteCache));
  const servicePlans: LineServicePlanMembership[] = [];
  for (const servicePlanId of servicePlanIds) {
    const servicePlan = projection.index.servicePlansById.get(servicePlanId);
    if (servicePlan === undefined) return rejected('missing-service-plan', servicePlanId);
    servicePlans.push({ servicePlanId, mode: servicePlan.mode });
  }
  return { lineId, servicePlans };
}

function patternRejection(
  projection: ResolvedNetworkProjection,
  patternId: string,
): CandidateRejection | undefined {
  const pattern = projection.index.patternsById.get(patternId);
  if (pattern === undefined) return rejected('missing-pattern', patternId);
  return pattern.path === 'known' ? undefined : rejected('unknown-pattern-path', patternId);
}

function candidateCarrierOrder(carrier: TransitCarrierRef): number {
  return carrier.kind === 'way' ? 0 : 1;
}

function compareOptionalIds(
  left: string | undefined,
  right: string | undefined,
  idByteCache: Map<string, Uint8Array>,
): number {
  if (left === undefined) return right === undefined ? 0 : -1;
  if (right === undefined) return 1;
  return compareIds(left, right, idByteCache);
}

function compareCandidateIds(
  left: LineSpanCandidate,
  right: LineSpanCandidate,
  idByteCache: Map<string, Uint8Array>,
): number {
  const lineDifference = compareIds(left.lineId, right.lineId, idByteCache);
  if (lineDifference !== 0) return lineDifference;
  const servicePlanDifference = compareIds(left.servicePlanId, right.servicePlanId, idByteCache);
  return servicePlanDifference !== 0
    ? servicePlanDifference
    : compareIds(left.patternId, right.patternId, idByteCache);
}

function compareCandidates(
  left: LineSpanCandidate,
  right: LineSpanCandidate,
  idByteCache: Map<string, Uint8Array>,
): number {
  const rankDifference = left.lineRank - right.lineRank;
  if (rankDifference !== 0) return rankDifference;
  const idDifference = compareCandidateIds(left, right, idByteCache);
  if (idDifference !== 0) return idDifference;
  const legDifference = left.legIndex - right.legIndex;
  if (legDifference !== 0) return legDifference;
  const kindDifference = candidateCarrierOrder(left.carrier) - candidateCarrierOrder(right.carrier);
  if (kindDifference !== 0) return kindDifference;
  const carrierDifference = compareIds(left.carrier.id, right.carrier.id, idByteCache);
  if (carrierDifference !== 0) return carrierDifference;
  const laneDifference = compareOptionalIds(
    left.carrier.kind === 'way' ? left.carrier.laneId : undefined,
    right.carrier.kind === 'way' ? right.carrier.laneId : undefined,
    idByteCache,
  );
  if (laneDifference !== 0) return laneDifference;
  const startDifference = left.logicalCarrierRange[0] - right.logicalCarrierRange[0];
  if (startDifference !== 0) return startDifference;
  const endDifference = left.logicalCarrierRange[1] - right.logicalCarrierRange[1];
  return endDifference !== 0
    ? endDifference
    : compareIds(left.logicalPatternLegFragmentId, right.logicalPatternLegFragmentId, idByteCache);
}

function candidatesForPatternLeg(
  projection: ResolvedNetworkProjection,
  patternLeg: PreparedPatternLeg,
  lineOrder: PreparedLineOrder,
  idByteCache: Map<string, Uint8Array>,
): readonly LineSpanCandidate[] | CandidateRejection {
  const { logical } = patternLeg;
  const visibleShards = logical.shards.filter(({ visible }) => visible);
  const invalidPattern = patternRejection(projection, logical.patternId);
  if (invalidPattern !== undefined) return invalidPattern;
  const membership = lineMembership(projection, logical.patternId, idByteCache);
  if ('kind' in membership) return membership;
  const lineRank = lineOrder.rankByLineId.get(membership.lineId);
  if (lineRank === undefined) return rejected('missing-line-order', membership.lineId);
  const shardIds = logical.shards.map(({ fragment }) => fragment.id) as [string, ...string[]];
  const visibleShardIds = visibleShards.map(({ fragment }) => fragment.id);
  return membership.servicePlans.map(({ servicePlanId, mode }) => ({
    lineId: membership.lineId,
    lineRank,
    servicePlanId,
    servicePlanMode: mode,
    patternId: logical.patternId,
    legIndex: logical.legIndex,
    direction: logical.direction,
    logicalPatternLegFragmentId: logical.id,
    carrier: logical.carrier,
    carrierGrade: patternLeg.carrierGrade,
    alignmentId: logical.alignmentId,
    alignmentMapping: patternLeg.alignmentMapping,
    logicalCarrierRange: logical.logicalCarrierRange,
    shardIds,
    visibleShardIds,
  }));
}

function candidatesByLineIdForPatternLegIndex(
  projection: ResolvedNetworkProjection,
  patternLegIndex: PreparedPatternLegIndex,
  lineOrder: PreparedLineOrder,
  idByteCache: Map<string, Uint8Array>,
): ReadonlyMap<string, ValidatedLineSpanCandidates> | CandidateRejection {
  const groups = new Map<string, LineSpanCandidate[]>(
    lineOrder.lineIds.map((lineId) => [lineId, []]),
  );
  for (const patternLeg of patternLegIndex.patternLegsByLogicalId.values()) {
    const result = candidatesForPatternLeg(projection, patternLeg, lineOrder, idByteCache);
    if ('kind' in result) return result;
    for (const candidate of result) groups.get(candidate.lineId)?.push(candidate);
  }
  for (const entries of groups.values())
    entries.sort((left, right) => compareCandidates(left, right, idByteCache));
  return new Map(
    lineOrder.lineIds.map((lineId) => [lineId, validatedCandidates(groups.get(lineId) ?? [])]),
  );
}

function validatedCandidates(
  candidates: readonly LineSpanCandidate[],
): ValidatedLineSpanCandidates {
  return candidates as unknown as ValidatedLineSpanCandidates;
}

export function prepareLineSpanCandidateContext(
  projection: ResolvedNetworkProjection,
): PrepareLineSpanCandidateContextResult {
  const idByteCache = new Map<string, Uint8Array>();
  const lineOrder = prepareLineOrder(projection, idByteCache);
  if (lineOrder.kind === 'rejected') return lineOrder;
  if (projection.result.nextCursor !== undefined) return { kind: 'pending', reason: 'more-pages' };
  const prepared = prepareLineSpanInput(projection.result.chunks);
  if (prepared.kind === 'rejected') return prepared;
  const patternLegIndex = preparePatternLegIndex(projection, prepared.input);
  if (patternLegIndex.kind === 'rejected') return patternLegIndex;
  const byLineId = candidatesByLineIdForPatternLegIndex(
    projection,
    patternLegIndex.index,
    lineOrder.order,
    idByteCache,
  );
  if ('kind' in byLineId) return byLineId;
  const context = {
    input: prepared.input,
    patternLegIndex: patternLegIndex.index,
    lineIds: lineOrder.order.lineIds,
    candidatesByLineId: byLineId,
  };
  return {
    kind: 'ready',
    context,
    lineIds: context.lineIds,
  };
}

/**
 * Direct callers still receive one flattened collection. New projection work
 * owns the Line-partitioned context and never needs this compatibility view.
 */
export function prepareLineSpanCandidates(
  projection: ResolvedNetworkProjection,
): PrepareLineSpanCandidatesResult {
  const prepared = prepareLineSpanCandidateContext(projection);
  if (prepared.kind !== 'ready') return prepared;
  return {
    kind: 'ready',
    candidates: validatedCandidates(
      prepared.lineIds.flatMap((lineId) => prepared.context.candidatesByLineId.get(lineId) ?? []),
    ),
    context: prepared.context,
  };
}

/**
 * Filtering a validated collection preserves its source-result provenance.
 * The worker uses this to keep exact-carrier work scoped to one Line.
 */
export function candidatesForLine(
  context: PreparedLineSpanCandidateContext,
  lineId: string,
): ValidatedLineSpanCandidates {
  return context.candidatesByLineId.get(lineId) ?? validatedCandidates([]);
}
