import { describe, expect, it } from 'vitest';
import type { LineSpanCandidate } from '../../src/line/line-span-candidates';
import {
  aLineSpanCandidate as aCandidate,
  deriveExactCarrierLineSpanAtoms,
  readyLineSpanAtoms as readyAtoms,
  readyLineSpanDerivation as readyDerivation,
} from '../support/line-span-atoms.test';

describe('Line span atom contributor evidence', () => {
  it('coalesces active duplicate contributors and unions their evidence', () => {
    const candidates = [
      aCandidate({
        logicalPatternLegFragmentId: 'logical-z',
        shardIds: ['m-shard', 'z-shard'],
        visibleShardIds: ['z-shard'],
      }),
      aCandidate({
        logicalPatternLegFragmentId: 'logical-a',
        shardIds: ['a-shard'],
        visibleShardIds: [],
      }),
    ];
    const derive = (input: readonly LineSpanCandidate[]) =>
      readyDerivation(
        deriveExactCarrierLineSpanAtoms({
          lineId: 'line',
          carrierRule: 'shared-alignment',
          candidates: input,
        }),
      );
    const forward = derive(candidates);

    expect(forward.atoms).toHaveLength(1);
    expect(forward.atoms[0]?.contributors).toHaveLength(1);
    expect(forward.evidence).toEqual([
      {
        atomIndex: 0,
        contributors: [
          {
            contributorIndex: 0,
            logicalPatternLegFragmentIds: ['logical-a', 'logical-z'],
            shardIds: ['a-shard', 'm-shard', 'z-shard'],
            visibleShardIds: ['z-shard'],
          },
        ],
      },
    ]);
    expect(derive([...candidates].reverse())).toEqual(forward);
  });

  it('orders contributors by semantic facts instead of input or shard order', () => {
    const candidates = [
      aCandidate({
        servicePlanId: 'plan-z',
        patternId: 'pattern-a',
        logicalPatternLegFragmentId: 'pattern-a-leg-0',
      }),
      aCandidate({
        servicePlanId: 'plan-a',
        patternId: 'pattern-z',
        logicalPatternLegFragmentId: 'pattern-z-leg-0',
      }),
      aCandidate({
        servicePlanId: 'plan-a',
        patternId: 'pattern-a',
        legIndex: 1,
        logicalPatternLegFragmentId: 'pattern-a-leg-1',
      }),
      aCandidate({
        servicePlanId: 'plan-a',
        patternId: 'pattern-a',
        logicalPatternLegFragmentId: 'pattern-a-leg-0',
      }),
    ];
    const derive = (input: readonly LineSpanCandidate[]) =>
      readyAtoms(
        deriveExactCarrierLineSpanAtoms({
          lineId: 'line',
          carrierRule: 'shared-alignment',
          candidates: input,
        }),
      );
    const forward = derive(candidates);
    const reversed = derive(
      [...candidates].reverse().map((candidate) => ({
        ...candidate,
        shardIds: [`replacement-${candidate.logicalPatternLegFragmentId}`] as const,
        visibleShardIds: [`replacement-${candidate.logicalPatternLegFragmentId}`] as const,
      })),
    );
    const contributorKeys = (atoms: typeof forward) =>
      atoms[0]?.contributors.map(
        ({ servicePlanId, patternId, legIndex }) => `${servicePlanId}/${patternId}/${legIndex}`,
      );

    expect(contributorKeys(forward)).toEqual([
      'plan-a/pattern-a/0',
      'plan-a/pattern-a/1',
      'plan-a/pattern-z/0',
      'plan-z/pattern-a/0',
    ]);
    expect(reversed).toEqual(forward);
  });

  it('keeps query-local shard evidence outside semantic atoms', () => {
    const result = readyDerivation(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [
          aCandidate({
            shardIds: ['topology-shard', 'visible-shard'],
            visibleShardIds: ['visible-shard'],
          }),
        ],
      }),
    );

    expect(result.atoms[0]).not.toHaveProperty('shardIds');
    expect(result.atoms[0]).not.toHaveProperty('visibleShardIds');
    expect(result.evidence).toEqual([
      {
        atomIndex: 0,
        contributors: [
          {
            contributorIndex: 0,
            logicalPatternLegFragmentIds: ['logical-leg'],
            shardIds: ['topology-shard', 'visible-shard'],
            visibleShardIds: ['visible-shard'],
          },
        ],
      },
    ]);
  });

  it('keeps closure-only siblings when visible evidence seeds their carrier', () => {
    const candidates = [
      aCandidate({ patternId: 'visible' }),
      aCandidate({
        servicePlanId: 'closure-plan',
        patternId: 'closure-only',
        logicalPatternLegFragmentId: 'closure-only-leg',
        logicalCarrierRange: [0.25, 0.75],
        visibleShardIds: [],
      }),
    ];
    const result = readyDerivation(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates,
      }),
    );

    expect(
      result.atoms.map(({ canonicalCarrierRange, contributors }) => ({
        range: canonicalCarrierRange,
        patterns: contributors.map(({ patternId }) => patternId),
      })),
    ).toEqual([
      { range: [0, 0.25], patterns: ['visible'] },
      { range: [0.25, 0.75], patterns: ['closure-only', 'visible'] },
      { range: [0.75, 1], patterns: ['visible'] },
    ]);
    expect(result.evidence[1]?.contributors[0]?.visibleShardIds).toEqual([]);

    const shiftedEvidence = readyDerivation(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: candidates.map((candidate, index) => ({
          ...candidate,
          visibleShardIds: index === 0 ? [] : ['closure-visible-shard'],
        })),
      }),
    );
    expect(shiftedEvidence.atoms).toEqual(result.atoms);
  });

  it('omits an unseeded carrier from exact atoms', () => {
    const result = readyDerivation(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [
          aCandidate({ patternId: 'visible' }),
          aCandidate({
            servicePlanId: 'topology-plan',
            patternId: 'topology-only',
            logicalPatternLegFragmentId: 'topology-only-leg',
            carrier: { kind: 'alignment', id: 'other-alignment' },
            alignmentId: 'other-alignment',
            visibleShardIds: [],
          }),
        ],
      }),
    );

    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0]?.contributors.map(({ patternId }) => patternId)).toEqual(['visible']);
  });

  it('omits unseeded physical deferrals', () => {
    const result = readyDerivation(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'same-physical-carrier',
        candidates: [
          aCandidate({
            carrier: { kind: 'way', id: 'visible-way', laneId: 'lane' },
          }),
          aCandidate({
            servicePlanId: 'bare-plan',
            patternId: 'bare-topology-only',
            logicalPatternLegFragmentId: 'bare-topology-only-leg',
            carrier: { kind: 'alignment', id: 'other-alignment' },
            alignmentId: 'other-alignment',
            visibleShardIds: [],
          }),
          aCandidate({
            servicePlanId: 'unresolved-plan',
            patternId: 'unresolved-topology-only',
            logicalPatternLegFragmentId: 'unresolved-topology-only-leg',
            carrier: { kind: 'way', id: 'other-way' },
            visibleShardIds: [],
          }),
        ],
      }),
    );

    expect(result.atoms).toHaveLength(1);
    expect(result.deferred).toEqual([]);
    expect(result.deferredEvidence).toEqual([]);
  });

  it('coalesces deferred semantic contributors and keeps their evidence separate', () => {
    const result = readyDerivation(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'same-physical-carrier',
        candidates: [
          aCandidate({
            logicalPatternLegFragmentId: 'logical-z',
            shardIds: ['shard-z'],
            visibleShardIds: ['visible-z'],
          }),
          aCandidate({
            logicalPatternLegFragmentId: 'logical-a',
            shardIds: ['shard-a'],
            visibleShardIds: [],
          }),
        ],
      }),
    );

    expect(result.deferred).toHaveLength(1);
    expect(result.deferred[0]).not.toHaveProperty('logicalPatternLegFragmentId');
    expect(result.deferred[0]).not.toHaveProperty('shardIds');
    expect(result.deferred[0]).not.toHaveProperty('visibleShardIds');
    expect(result.deferredEvidence).toEqual([
      {
        deferredIndex: 0,
        logicalPatternLegFragmentIds: ['logical-a', 'logical-z'],
        shardIds: ['shard-a', 'shard-z'],
        visibleShardIds: ['visible-z'],
      },
    ]);
  });

  it('retains trusted mode and grade when physical grouping defers a candidate', () => {
    const result = readyDerivation(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'same-physical-carrier',
        candidates: [
          aCandidate({
            carrier: { kind: 'way', id: 'way' },
            servicePlanMode: { kind: 'known', value: 'rail' },
            carrierGrade: 'elevated',
          }),
        ],
      }),
    );

    expect(result.deferred).toEqual([
      expect.objectContaining({
        servicePlanMode: { kind: 'known', value: 'rail' },
        carrierGrade: 'elevated',
      }),
    ]);
  });

  it('rejects conflicting duplicate contributors before physical deferral', () => {
    const conflictingDirections = [
      aCandidate({ logicalPatternLegFragmentId: 'logical-z' }),
      aCandidate({ logicalPatternLegFragmentId: 'logical-a', direction: 'reverse' }),
    ];
    const derive = (candidates: readonly LineSpanCandidate[]) =>
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'same-physical-carrier',
        candidates,
      });

    expect(derive(conflictingDirections)).toEqual({
      kind: 'rejected',
      reason: 'duplicate-contributor-conflict',
      recordId: 'logical-a',
    });
    expect(derive([...conflictingDirections].reverse())).toEqual(derive(conflictingDirections));

    expect(
      derive([
        aCandidate({
          logicalPatternLegFragmentId: 'logical-z',
          carrier: { kind: 'way', id: 'way' },
          alignmentMapping: { kind: 'way-affine', alignmentExtent: [0, 0.8] },
        }),
        aCandidate({
          logicalPatternLegFragmentId: 'logical-a',
          carrier: { kind: 'way', id: 'way' },
          alignmentMapping: { kind: 'way-affine', alignmentExtent: [0, 0.9] },
        }),
      ]),
    ).toEqual({
      kind: 'rejected',
      reason: 'duplicate-contributor-conflict',
      recordId: 'logical-a',
    });
  });
});
