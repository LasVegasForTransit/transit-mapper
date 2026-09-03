import { describe, expect, it } from 'vitest';
import type { LineSpanCandidate } from '../../src/line/line-span-candidates';
import {
  aLineSpanCandidate as aCandidate,
  deriveExactCarrierLineSpanAtoms,
  readyLineSpanAtoms as readyAtoms,
} from '../support/line-span-atoms.test';

describe('Line span atom validation', () => {
  it('rejects candidates outside the requested Line in canonical order', () => {
    const candidates = [
      aCandidate({ lineId: 'line-b', logicalPatternLegFragmentId: 'logical-z' }),
      aCandidate({ lineId: 'line-a', logicalPatternLegFragmentId: 'logical-a' }),
    ];
    const derive = (input: readonly LineSpanCandidate[]) =>
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: input,
      });

    expect(derive(candidates)).toEqual({
      kind: 'rejected',
      reason: 'line-scope-conflict',
      recordId: 'logical-a',
    });
    expect(derive([...candidates].reverse())).toEqual(derive(candidates));
  });

  it('rejects inconsistent Line rank inside one Line partition', () => {
    expect(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [aCandidate(), aCandidate({ lineRank: 1 })],
      }),
    ).toEqual({ kind: 'rejected', reason: 'line-rank-conflict', recordId: 'line' });
  });

  it('rejects conflicting trusted carrier evidence for one logical contributor', () => {
    expect(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [
          aCandidate({ carrierGrade: undefined }),
          aCandidate({ carrierGrade: 'atGrade' }),
        ],
      }),
    ).toEqual({
      kind: 'rejected',
      reason: 'duplicate-contributor-conflict',
      recordId: 'logical-leg',
    });
  });

  it('returns an empty result for an empty Line partition', () => {
    expect(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [],
      }),
    ).toEqual({ kind: 'ready', atoms: [], evidence: [], deferred: [], deferredEvidence: [] });
  });

  it('rejects a positive atom whose six-decimal identity range collapses', () => {
    expect(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [aCandidate({ logicalCarrierRange: [0.1234561, 0.1234564] })],
      }),
    ).toEqual({
      kind: 'rejected',
      reason: 'identity-range-collapse',
      recordId: 'logical-leg',
    });

    const atoms = readyAtoms(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [aCandidate({ logicalCarrierRange: [0.1234564, 0.1234566] })],
      }),
    );
    expect(atoms).toHaveLength(1);
    expect(atoms[0]?.canonicalCarrierRange).toEqual([0.1234564, 0.1234566]);
    expect(atoms[0]?.identityPreimage).toEqual({
      version: 'line-overlap-v1',
      kind: 'exact-carrier',
      lineId: 'line',
      canonicalCarrier: { kind: 'alignment', id: 'alignment' },
      canonicalCarrierRange: [0.123456, 0.123457],
    });
  });

  it('rejects a Way candidate without a validated Way mapping', () => {
    expect(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [
          aCandidate({
            carrier: { kind: 'way', id: 'way', laneId: 'lane' },
            alignmentMapping: { kind: 'identity' },
          }),
        ],
      }),
    ).toEqual({
      kind: 'rejected',
      reason: 'candidate-mapping-conflict',
      recordId: 'logical-leg',
    });
  });

  it('reports invalid candidate mappings in canonical order', () => {
    const candidates = [
      aCandidate({
        logicalPatternLegFragmentId: 'logical-z',
        carrier: { kind: 'way', id: 'way', laneId: 'lane' },
        alignmentMapping: { kind: 'identity' },
      }),
      aCandidate({
        logicalPatternLegFragmentId: 'logical-a',
        carrier: { kind: 'way', id: 'way', laneId: 'lane' },
        alignmentMapping: { kind: 'identity' },
      }),
    ];
    const forward = deriveExactCarrierLineSpanAtoms({
      lineId: 'line',
      carrierRule: 'shared-alignment',
      candidates,
    });
    expect(forward).toEqual({
      kind: 'rejected',
      reason: 'candidate-mapping-conflict',
      recordId: 'logical-a',
    });
    expect(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [...candidates].reverse(),
      }),
    ).toEqual(forward);
  });
});
