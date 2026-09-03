import { mapNormalizedRange } from '@transitmapper/core/network/carrier-alignment';
import type { ResolvedCarrierFragment } from '@transitmapper/core/network/resolved-network-chunk';
import { sameTransitCarrier } from '@transitmapper/core/transit/value-types';
import type { ExactCarrierLineSpanDerivation } from './line-span-atoms';
import type { PreparedLineSpanCandidateContext } from './line-span-candidates';
import type { SameLineCarrierRule } from './line-span-candidate-groups';
import type { LineSpanContributor } from './line-span-types';

export type VisibleLineSpanRejectionReason =
  | 'missing-visible-shard'
  | 'visible-shard-logical-leg-conflict'
  | 'visible-shard-carrier-conflict'
  | 'invalid-visible-carrier-geometry'
  | 'degenerate-visible-carrier-geometry';

export interface VisibleFragmentRejection {
  readonly kind: 'rejected';
  readonly reason: VisibleLineSpanRejectionReason;
  readonly recordId: string;
}

export interface VisibleSourcePiece {
  readonly canonicalCarrierRange: readonly [number, number];
  readonly sourceCanonicalCarrierRange: readonly [number, number];
  readonly contributorIndex: number;
  readonly sourceShardId: string;
  readonly sourceCarrier: ResolvedCarrierFragment;
}

type ReadyDerivation = Extract<ExactCarrierLineSpanDerivation, { readonly kind: 'ready' }>;
type PatternLegShardsById =
  PreparedLineSpanCandidateContext['patternLegIndex']['patternLegShardsById'];
type VisibleSource = Exclude<ReturnType<PatternLegShardsById['get']>, undefined>;

interface VisibleSourcePiecesOptions {
  readonly derivation: ReadyDerivation;
  readonly carrierRule: SameLineCarrierRule;
  readonly patternLegShardsById: PatternLegShardsById;
}

interface SourcePieceOptions {
  readonly atomRange: readonly [number, number];
  readonly contributor: LineSpanContributor;
  readonly contributorIndex: number;
  readonly carrierRule: SameLineCarrierRule;
  readonly logicalPatternLegFragmentIds: readonly string[];
  readonly sourceShardId: string;
  readonly patternLegShardsById: PatternLegShardsById;
}

function intersectRanges(
  left: readonly [number, number],
  right: readonly [number, number],
): readonly [number, number] | undefined {
  const start = Math.max(left[0], right[0]);
  const end = Math.min(left[1], right[1]);
  return start < end ? [start, end] : undefined;
}

function sourceCanonicalRange(
  source: VisibleSource,
  carrierRule: SameLineCarrierRule,
): readonly [number, number] {
  if (carrierRule === 'same-physical-carrier') return source.shard.fragment.carrierRange;
  const { alignmentMapping } = source.patternLeg;
  return alignmentMapping.kind === 'identity'
    ? source.shard.fragment.carrierRange
    : mapNormalizedRange(
        source.shard.fragment.carrierRange,
        [0, 1],
        alignmentMapping.alignmentExtent,
      );
}

function sourcePiece(
  options: SourcePieceOptions,
): VisibleSourcePiece | VisibleFragmentRejection | undefined {
  const source = options.patternLegShardsById.get(options.sourceShardId);
  if (source === undefined)
    return { kind: 'rejected', reason: 'missing-visible-shard', recordId: options.sourceShardId };
  if (!options.logicalPatternLegFragmentIds.includes(source.patternLeg.logical.id)) {
    return {
      kind: 'rejected',
      reason: 'visible-shard-logical-leg-conflict',
      recordId: options.sourceShardId,
    };
  }
  if (!sameTransitCarrier(source.patternLeg.logical.carrier, options.contributor.carrier)) {
    return {
      kind: 'rejected',
      reason: 'visible-shard-carrier-conflict',
      recordId: options.sourceShardId,
    };
  }
  const sourceRange = sourceCanonicalRange(source, options.carrierRule);
  const canonicalCarrierRange = intersectRanges(options.atomRange, sourceRange);
  return canonicalCarrierRange === undefined
    ? undefined
    : {
        canonicalCarrierRange,
        sourceCanonicalCarrierRange: sourceRange,
        contributorIndex: options.contributorIndex,
        sourceShardId: options.sourceShardId,
        sourceCarrier: source.shard.carrier,
      };
}

export function visiblePiecesForAtom(
  options: VisibleSourcePiecesOptions,
  atomIndex: number,
): readonly VisibleSourcePiece[] | VisibleFragmentRejection {
  const atom = options.derivation.atoms.at(atomIndex);
  const evidence = options.derivation.evidence.at(atomIndex);
  if (atom === undefined || evidence === undefined)
    throw new Error('Exact Line span derivation lost atom evidence.');
  const pieces: VisibleSourcePiece[] = [];
  for (const contributorEvidence of evidence.contributors) {
    const contributor = atom.contributors.at(contributorEvidence.contributorIndex);
    if (contributor === undefined)
      throw new Error('Exact Line span derivation lost contributor evidence.');
    for (const sourceShardId of contributorEvidence.visibleShardIds) {
      const piece = sourcePiece({
        atomRange: atom.canonicalCarrierRange,
        contributor,
        contributorIndex: contributorEvidence.contributorIndex,
        carrierRule: options.carrierRule,
        logicalPatternLegFragmentIds: contributorEvidence.logicalPatternLegFragmentIds,
        sourceShardId,
        patternLegShardsById: options.patternLegShardsById,
      });
      if (piece === undefined) continue;
      if (isVisibleFragmentRejection(piece)) return piece;
      pieces.push(piece);
    }
  }
  return pieces;
}

export function isVisibleFragmentRejection(value: unknown): value is VisibleFragmentRejection {
  return (
    typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'rejected'
  );
}
