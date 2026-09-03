import { canonicalValueBytes } from '@transitmapper/core/encoding/canonical-value';
import { candidatesForLine, type PreparedLineSpanCandidateContext } from './line-span-candidates';
import {
  deriveExactCarrierLineSpanAtoms,
  type ExactCarrierLineSpanDerivation,
} from './line-span-atoms';
import type { SameLineCarrierRule } from './line-span-candidate-groups';
import type { LineSpan, VisibleLineSpanFragment } from './line-span-types';
import { materializeVisibleLineFragments } from './line-visible-fragments';
import type { VisibleLineSpanRejectionReason } from './line-visible-sources';

export interface MaterializeExactLineSpansOptions {
  readonly context: PreparedLineSpanCandidateContext;
  readonly lineId: string;
  readonly carrierRule: SameLineCarrierRule;
}

export type MaterializeExactLineSpansResult =
  | {
      readonly kind: 'ready';
      readonly spans: readonly LineSpan[];
      readonly visibleFragments: readonly VisibleLineSpanFragment[];
    }
  | { readonly kind: 'pending'; readonly reason: 'more-pages' }
  | {
      readonly kind: 'rejected';
      readonly reason:
        | Extract<ExactCarrierLineSpanDerivation, { readonly kind: 'rejected' }>['reason']
        | VisibleLineSpanRejectionReason;
      readonly recordId: string;
    };

function digestCanonicalValue(value: unknown): Promise<string> {
  return crypto.subtle
    .digest('SHA-256', Uint8Array.from(canonicalValueBytes(value)).buffer)
    .then((buffer) =>
      Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    );
}

/** Materializes stable Line spans while leaving query-local geometry to the visible-fragment stage. */
export async function materializeExactLineSpans(
  options: MaterializeExactLineSpansOptions,
): Promise<MaterializeExactLineSpansResult> {
  const derivation = deriveExactCarrierLineSpanAtoms({
    lineId: options.lineId,
    carrierRule: options.carrierRule,
    candidates: candidatesForLine(options.context, options.lineId),
  });
  if (derivation.kind === 'rejected') return derivation;
  const spans: LineSpan[] = [];
  for (const atom of derivation.atoms) {
    spans.push({
      id: await digestCanonicalValue(atom.identityPreimage),
      lineId: atom.lineId,
      contributors: atom.contributors,
      canonicalCarrier: atom.canonicalCarrier,
      canonicalCarrierRange: atom.canonicalCarrierRange,
    });
  }
  const fragments = await materializeVisibleLineFragments({
    derivation,
    spans,
    carrierRule: options.carrierRule,
    patternLegShardsById: options.context.patternLegIndex.patternLegShardsById,
  });
  if (fragments.kind === 'rejected') return fragments;
  return { kind: 'ready', spans, visibleFragments: fragments.visibleFragments };
}
