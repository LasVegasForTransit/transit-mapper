import {
  mapNormalizedRange,
  sameNormalizedRange,
  type NormalizedRange,
} from '@transitmapper/core/network/carrier-alignment';
import type { NetworkQueryResult } from '@transitmapper/core/network/result';
import type { Grade } from '@transitmapper/core/transit/value-types';
import type { ResolvedNetworkProjection } from '../network/resolved-network-projection';
import type {
  PreparedLineSpanInput,
  PreparedLineSpanShard,
  PreparedLogicalPatternLeg,
} from './line-spans';

export type PatternLegAlignmentMapping =
  | { readonly kind: 'identity' }
  | { readonly kind: 'way-affine'; readonly alignmentExtent: NormalizedRange };

export interface PreparedPatternLeg {
  readonly logical: PreparedLogicalPatternLeg;
  readonly alignmentMapping: PatternLegAlignmentMapping;
  /** A Way grade is trusted only after this index confirms its carrier reference. */
  readonly carrierGrade: Grade | undefined;
}

export interface PreparedPatternLegIndex {
  /** The index only applies to the exact resolved result that supplied its raw shards. */
  readonly sourceResult: NetworkQueryResult;
  readonly patternLegsByLogicalId: ReadonlyMap<string, PreparedPatternLeg>;
  readonly patternLegShardsById: ReadonlyMap<
    string,
    { readonly patternLeg: PreparedPatternLeg; readonly shard: PreparedLineSpanShard }
  >;
}

export type PatternLegRejectionReason =
  | 'missing-alignment'
  | 'carrier-alignment-conflict'
  | 'missing-way'
  | 'invalid-way-alignment-extent'
  | 'way-alignment-range-conflict'
  | 'way-alignment-shard-conflict'
  | 'missing-way-lane';

export type PreparePatternLegIndexResult =
  | { readonly kind: 'ready'; readonly index: PreparedPatternLegIndex }
  | {
      readonly kind: 'rejected';
      readonly reason: PatternLegRejectionReason;
      readonly recordId: string;
    };

type RejectedPatternLegIndex = Extract<PreparePatternLegIndexResult, { readonly kind: 'rejected' }>;

function rejected(reason: PatternLegRejectionReason, recordId: string): RejectedPatternLegIndex {
  return { kind: 'rejected', reason, recordId };
}

function validNormalizedRange(range: readonly [number, number]): boolean {
  return (
    Number.isFinite(range[0]) &&
    Number.isFinite(range[1]) &&
    range[0] >= 0 &&
    range[0] < range[1] &&
    range[1] <= 1
  );
}

interface ValidatedCarrierEvidence {
  readonly alignmentMapping: PatternLegAlignmentMapping;
  readonly carrierGrade: Grade | undefined;
}

function validateCarrierEvidence(
  projection: ResolvedNetworkProjection,
  logical: PreparedLogicalPatternLeg,
):
  | { readonly kind: 'ready'; readonly evidence: ValidatedCarrierEvidence }
  | RejectedPatternLegIndex {
  if (!projection.index.alignmentsById.has(logical.alignmentId)) {
    return rejected('missing-alignment', logical.alignmentId);
  }
  if (logical.carrier.kind === 'alignment') {
    return logical.carrier.id === logical.alignmentId
      ? {
          kind: 'ready',
          evidence: { alignmentMapping: { kind: 'identity' }, carrierGrade: undefined },
        }
      : rejected('carrier-alignment-conflict', logical.carrier.id);
  }
  const way = projection.index.waysById.get(logical.carrier.id);
  if (way === undefined) return rejected('missing-way', logical.carrier.id);
  if (way.alignmentId !== logical.alignmentId) {
    return rejected('carrier-alignment-conflict', logical.carrier.id);
  }
  if (!validNormalizedRange(way.alignmentExtent)) {
    return rejected('invalid-way-alignment-extent', way.id);
  }
  const expectedAlignmentRange = mapNormalizedRange(
    logical.logicalCarrierRange,
    [0, 1],
    way.alignmentExtent,
  );
  if (!sameNormalizedRange(logical.logicalAlignmentRange, expectedAlignmentRange)) {
    return rejected('way-alignment-range-conflict', logical.id);
  }
  for (const { fragment, carrier } of logical.shards) {
    const expectedShardAlignmentRange = mapNormalizedRange(
      fragment.carrierRange,
      [0, 1],
      way.alignmentExtent,
    );
    if (!sameNormalizedRange(carrier.alignmentRange, expectedShardAlignmentRange)) {
      return rejected('way-alignment-shard-conflict', fragment.id);
    }
  }
  const laneId = logical.carrier.laneId;
  if (laneId !== undefined && !way.profile.lanes.some(({ id }) => id === laneId)) {
    return rejected('missing-way-lane', laneId);
  }
  return {
    kind: 'ready',
    evidence: {
      alignmentMapping: { kind: 'way-affine', alignmentExtent: way.alignmentExtent },
      carrierGrade: way.grade,
    },
  };
}

/**
 * Candidate and topology stages share these records, so neither stage treats
 * raw transferred geometry as physical-carrier evidence.
 */
export function preparePatternLegIndex(
  projection: ResolvedNetworkProjection,
  input: PreparedLineSpanInput,
): PreparePatternLegIndexResult {
  const patternLegsByLogicalId = new Map<string, PreparedPatternLeg>();
  const patternLegShardsById = new Map<
    string,
    { readonly patternLeg: PreparedPatternLeg; readonly shard: PreparedLineSpanShard }
  >();
  for (const logical of input.logicalPatternLegsById.values()) {
    const carrierEvidence = validateCarrierEvidence(projection, logical);
    if (carrierEvidence.kind === 'rejected') return carrierEvidence;
    const patternLeg = { logical, ...carrierEvidence.evidence } satisfies PreparedPatternLeg;
    patternLegsByLogicalId.set(logical.id, patternLeg);
    for (const shard of logical.shards) {
      patternLegShardsById.set(shard.fragment.id, { patternLeg, shard });
    }
  }
  return {
    kind: 'ready',
    index: { sourceResult: projection.result, patternLegsByLogicalId, patternLegShardsById },
  };
}
