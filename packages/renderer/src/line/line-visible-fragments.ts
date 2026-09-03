import { canonicalValueBytes } from '@transitmapper/core/encoding/canonical-value';
import type { ExactCarrierLineSpanDerivation } from './line-span-atoms';
import type { PreparedLineSpanCandidateContext } from './line-span-candidates';
import type { SameLineCarrierRule } from './line-span-candidate-groups';
import type { LineSpan, VisibleLineSpanFragment } from './line-span-types';
import { createVisibleFragmentGeometryResolver } from './line-visible-geometry';
import { partitionVisibleSourcePieces } from './line-visible-partitions';
import {
  isVisibleFragmentRejection,
  type VisibleFragmentRejection,
  visiblePiecesForAtom,
} from './line-visible-sources';

type ReadyDerivation = Extract<ExactCarrierLineSpanDerivation, { readonly kind: 'ready' }>;
type PatternLegShardsById =
  PreparedLineSpanCandidateContext['patternLegIndex']['patternLegShardsById'];

interface VisibleFragmentOptions {
  readonly derivation: ReadyDerivation;
  readonly spans: readonly LineSpan[];
  readonly carrierRule: SameLineCarrierRule;
  readonly patternLegShardsById: PatternLegShardsById;
}

function digestVisibleFragment(
  lineSpanId: string,
  range: readonly [number, number],
): Promise<string> {
  return crypto.subtle
    .digest(
      'SHA-256',
      Uint8Array.from(canonicalValueBytes(['line-visible-fragment-v1', lineSpanId, range])).buffer,
    )
    .then((buffer) =>
      Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    );
}

export async function materializeVisibleLineFragments(
  options: VisibleFragmentOptions,
): Promise<
  | { readonly kind: 'ready'; readonly visibleFragments: readonly VisibleLineSpanFragment[] }
  | VisibleFragmentRejection
> {
  const visibleFragments: VisibleLineSpanFragment[] = [];
  const geometry = createVisibleFragmentGeometryResolver();
  for (let atomIndex = 0; atomIndex < options.derivation.atoms.length; atomIndex += 1) {
    const span = options.spans.at(atomIndex);
    if (span === undefined) throw new Error('Exact Line span materialization lost its span.');
    const pieces = visiblePiecesForAtom(options, atomIndex);
    if (isVisibleFragmentRejection(pieces)) return pieces;
    for (const partition of partitionVisibleSourcePieces(pieces)) {
      const visibleGeometry = geometry.geometryForPartition(partition);
      if (isVisibleFragmentRejection(visibleGeometry)) return visibleGeometry;
      visibleFragments.push({
        id: await digestVisibleFragment(span.id, partition.canonicalCarrierRange),
        lineSpanId: span.id,
        canonicalCarrierRange: partition.canonicalCarrierRange,
        sourceShardIds: [partition.piece.sourceShardId],
        geometry: visibleGeometry,
      });
    }
  }
  return { kind: 'ready', visibleFragments };
}
