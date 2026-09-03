import { expect } from 'vitest';
import type {
  LineSpanCandidate,
  ValidatedLineSpanCandidates,
} from '../../src/line/line-span-candidates';
import {
  deriveExactCarrierLineSpanAtoms as deriveValidatedExactCarrierLineSpanAtoms,
  type DeriveExactCarrierLineSpanAtomsOptions,
  type ExactCarrierLineSpanDerivation,
} from '../../src/line/line-span-atoms';

export function aLineSpanCandidate(overrides: Partial<LineSpanCandidate> = {}): LineSpanCandidate {
  const carrier = overrides.carrier ?? { kind: 'alignment', id: 'alignment' };
  const alignmentMapping =
    overrides.alignmentMapping ??
    (carrier.kind === 'way'
      ? ({ kind: 'way-affine', alignmentExtent: [0, 1] } as const)
      : ({ kind: 'identity' } as const));
  return {
    lineId: 'line',
    lineRank: 0,
    servicePlanId: 'plan',
    servicePlanMode: { kind: 'known', value: 'bus' },
    patternId: 'pattern',
    legIndex: 0,
    direction: 'forward',
    logicalPatternLegFragmentId: 'logical-leg',
    carrier,
    carrierGrade: undefined,
    alignmentId: 'alignment',
    alignmentMapping,
    logicalCarrierRange: [0, 1],
    shardIds: ['shard'],
    visibleShardIds: ['shard'],
    ...overrides,
  };
}

/**
 * Focused atom tests exercise defensive rejection paths that cannot be
 * produced by a validated network result. Production callers cannot import
 * this test-only cast.
 */
export function deriveExactCarrierLineSpanAtoms(
  options: Omit<DeriveExactCarrierLineSpanAtomsOptions, 'candidates'> & {
    readonly candidates: readonly LineSpanCandidate[];
  },
): ExactCarrierLineSpanDerivation {
  return deriveValidatedExactCarrierLineSpanAtoms({
    ...options,
    candidates: options.candidates as ValidatedLineSpanCandidates,
  });
}

export function readyLineSpanDerivation(
  result: ExactCarrierLineSpanDerivation,
): Extract<ExactCarrierLineSpanDerivation, { readonly kind: 'ready' }> {
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') throw new Error(`Expected ready atoms, received ${result.kind}.`);
  return result;
}

export function readyLineSpanAtoms(
  result: ExactCarrierLineSpanDerivation,
): Extract<ExactCarrierLineSpanDerivation, { readonly kind: 'ready' }>['atoms'] {
  return readyLineSpanDerivation(result).atoms;
}
