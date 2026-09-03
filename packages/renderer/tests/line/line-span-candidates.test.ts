import { describe, expect, it } from 'vitest';
import {
  prepareLineSpanCandidateContext,
  prepareLineSpanCandidates,
} from '../../src/line/line-span-candidates';
import {
  aLineSpanChunk,
  aLineSpanProjection,
  aResolvedCarrier,
  aResolvedPatternLeg,
} from '../support/line-spans.test';

describe('Line span candidate preparation', () => {
  it('creates one Line-owned candidate for one logical Pattern leg across visible shards', () => {
    const chunk = aLineSpanChunk();
    const eastCarrier = aResolvedCarrier({
      id: 'carrier-east',
      alignmentRange: [0.7, 0.9],
    });
    const eastLeg = aResolvedPatternLeg({
      id: 'leg-east',
      carrierFragmentId: eastCarrier.id,
      carrierRange: [0.7, 0.9],
    });
    const result = prepareLineSpanCandidates(
      aLineSpanProjection({
        chunks: [
          {
            ...chunk,
            geometry: {
              carriers: [...chunk.geometry.carriers, eastCarrier],
              patternLegs: [...chunk.geometry.patternLegs, eastLeg],
              visiblePatternLegFragmentIds: ['leg-shard', eastLeg.id],
            },
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      kind: 'ready',
      candidates: [
        {
          lineId: 'line',
          lineRank: 0,
          servicePlanId: 'plan',
          patternId: 'pattern',
          legIndex: 0,
          logicalPatternLegFragmentId: 'logical-leg',
          logicalCarrierRange: [0, 1],
          alignmentMapping: { kind: 'identity' },
          shardIds: ['leg-shard', 'leg-east'],
          visibleShardIds: ['leg-shard', 'leg-east'],
        },
      ],
    });
  });

  it('keeps schedule variants under one Line as separate contributors', () => {
    const chunk = aLineSpanChunk();
    const result = prepareLineSpanCandidates(
      aLineSpanProjection({
        chunks: [
          {
            ...chunk,
            entities: {
              ...chunk.entities,
              servicePlans: [
                ...chunk.entities.servicePlans,
                { id: 'plan-weekend', mode: { kind: 'known', value: 'bus' }, activity: 'active' },
              ],
            },
            relationships: {
              ...chunk.relationships,
              lineServicePlans: [
                ...chunk.relationships.lineServicePlans,
                { id: 'line-weekend', lineId: 'line', servicePlanId: 'plan-weekend' },
              ],
              servicePlanPatterns: [
                ...chunk.relationships.servicePlanPatterns,
                { id: 'weekend-pattern', servicePlanId: 'plan-weekend', patternId: 'pattern' },
              ],
            },
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      kind: 'ready',
      candidates: [{ servicePlanId: 'plan' }, { servicePlanId: 'plan-weekend' }],
    });
  });

  it('deduplicates repeated membership facts for one Line and ServicePlan', () => {
    const chunk = aLineSpanChunk();
    const result = prepareLineSpanCandidates(
      aLineSpanProjection({
        chunks: [
          {
            ...chunk,
            relationships: {
              ...chunk.relationships,
              lineServicePlans: [
                ...chunk.relationships.lineServicePlans,
                { id: 'line-plan-repeat', lineId: 'line', servicePlanId: 'plan' },
              ],
              servicePlanPatterns: [
                ...chunk.relationships.servicePlanPatterns,
                { id: 'plan-pattern-repeat', servicePlanId: 'plan', patternId: 'pattern' },
              ],
            },
          },
        ],
      }),
    );

    expect(result).toMatchObject({ kind: 'ready', candidates: [{ servicePlanId: 'plan' }] });
    if (result.kind === 'ready') expect(result.candidates).toHaveLength(1);
  });

  it('keeps a topology-only logical Pattern leg with empty query evidence', () => {
    const chunk = aLineSpanChunk();
    const result = prepareLineSpanCandidates(
      aLineSpanProjection({
        chunks: [
          {
            ...chunk,
            geometry: { ...chunk.geometry, visiblePatternLegFragmentIds: [] },
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      kind: 'ready',
      candidates: [
        {
          logicalPatternLegFragmentId: 'logical-leg',
          shardIds: ['leg-shard'],
          visibleShardIds: [],
        },
      ],
    });
  });

  it('rejects a candidate whose ServicePlan record is absent', () => {
    const chunk = aLineSpanChunk();

    expect(
      prepareLineSpanCandidates(
        aLineSpanProjection({
          chunks: [
            {
              ...chunk,
              entities: { ...chunk.entities, servicePlans: [] },
            },
          ],
        }),
      ),
    ).toEqual({ kind: 'rejected', reason: 'missing-service-plan', recordId: 'plan' });
  });

  it('rejects a topology-only candidate whose Pattern record is absent', () => {
    const chunk = aLineSpanChunk();

    expect(
      prepareLineSpanCandidates(
        aLineSpanProjection({
          chunks: [
            {
              ...chunk,
              entities: { ...chunk.entities, patterns: [] },
              geometry: { ...chunk.geometry, visiblePatternLegFragmentIds: [] },
            },
          ],
        }),
      ),
    ).toEqual({ kind: 'rejected', reason: 'missing-pattern', recordId: 'pattern' });
  });

  it('rejects an unknown Pattern before it can contribute topology-only carrier evidence', () => {
    const chunk = aLineSpanChunk();

    expect(
      prepareLineSpanCandidates(
        aLineSpanProjection({
          chunks: [
            {
              ...chunk,
              entities: {
                ...chunk.entities,
                patterns: [{ id: 'pattern', path: 'unknown' }],
              },
              geometry: { ...chunk.geometry, visiblePatternLegFragmentIds: [] },
            },
          ],
        }),
      ),
    ).toEqual({ kind: 'rejected', reason: 'unknown-pattern-path', recordId: 'pattern' });
  });

  it('rejects a Line order with a rank gap', () => {
    expect(
      prepareLineSpanCandidates(aLineSpanProjection({ lineOrder: [{ lineId: 'line', rank: 1 }] })),
    ).toEqual({ kind: 'rejected', reason: 'invalid-line-order', recordId: 'line' });
  });

  it('retains resolved mode and physical grade with each candidate', () => {
    const chunk = aLineSpanChunk();
    const physicalCarrier = aResolvedCarrier({
      carrier: { kind: 'way', id: 'way', laneId: 'lane' },
    });
    const physicalLeg = aResolvedPatternLeg({ carrierFragmentId: physicalCarrier.id });
    const result = prepareLineSpanCandidates(
      aLineSpanProjection({
        chunks: [
          {
            ...chunk,
            entities: {
              ...chunk.entities,
              ways: [
                {
                  id: 'way',
                  alignmentId: 'alignment',
                  alignmentExtent: [0, 1],
                  typeId: 'road',
                  grade: 'atGrade',
                  profile: {
                    lanes: [{ id: 'lane', kindId: 'bus', widthMeters: 3, direction: 'forward' }],
                  },
                },
              ],
            },
            geometry: {
              carriers: [physicalCarrier],
              patternLegs: [physicalLeg],
              visiblePatternLegFragmentIds: [physicalLeg.id],
            },
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      kind: 'ready',
      candidates: [
        {
          servicePlanMode: { kind: 'known', value: 'bus' },
          carrierGrade: 'atGrade',
        },
      ],
    });
  });

  it('waits for every page before fixing candidate boundaries', () => {
    expect(prepareLineSpanCandidates(aLineSpanProjection({ nextCursor: 'page-2' }))).toEqual({
      kind: 'pending',
      reason: 'more-pages',
    });
  });

  it('keeps ranked Line order while retaining an empty Line partition', () => {
    const result = prepareLineSpanCandidateContext(
      aLineSpanProjection({
        lineOrder: [
          { lineId: 'line', rank: 1 },
          { lineId: 'empty-line', rank: 0 },
        ],
      }),
    );

    expect(result).toMatchObject({ kind: 'ready', lineIds: ['empty-line', 'line'] });
    if (result.kind !== 'ready') throw new Error('Expected prepared Line candidate context.');
    expect(result.context.candidatesByLineId.get('empty-line')).toEqual([]);
    expect(result.context.candidatesByLineId.get('line')).toHaveLength(1);
  });

  it('waits for another page before normalizing malformed geometry', () => {
    const chunk = aLineSpanChunk();

    expect(
      prepareLineSpanCandidateContext(
        aLineSpanProjection({
          chunks: [
            {
              ...chunk,
              geometry: {
                ...chunk.geometry,
                patternLegs: [aResolvedPatternLeg({ carrierRange: [0.75, 0.25] })],
              },
            },
          ],
          nextCursor: 'page-2',
        }),
      ),
    ).toEqual({ kind: 'pending', reason: 'more-pages' });
  });

  it('rejects invalid Line order before waiting for another page', () => {
    expect(
      prepareLineSpanCandidates(
        aLineSpanProjection({
          lineOrder: [{ lineId: 'line', rank: -1 }],
          nextCursor: 'page-2',
        }),
      ),
    ).toEqual({ kind: 'rejected', reason: 'invalid-line-order', recordId: 'line' });
  });

  it('rejects a visible Pattern without one Line owner', () => {
    const chunk = aLineSpanChunk();
    expect(
      prepareLineSpanCandidates(
        aLineSpanProjection({
          chunks: [
            {
              ...chunk,
              relationships: { ...chunk.relationships, lineServicePlans: [] },
            },
          ],
        }),
      ),
    ).toEqual({ kind: 'rejected', reason: 'missing-line-membership', recordId: 'pattern' });
  });

  it('rejects a visible Pattern owned by different Lines', () => {
    const chunk = aLineSpanChunk();
    expect(
      prepareLineSpanCandidates(
        aLineSpanProjection({
          lineOrder: [
            { lineId: 'line', rank: 0 },
            { lineId: 'other-line', rank: 1 },
          ],
          chunks: [
            {
              ...chunk,
              entities: {
                ...chunk.entities,
                lines: [...chunk.entities.lines, { id: 'other-line' }],
              },
              relationships: {
                ...chunk.relationships,
                lineServicePlans: [
                  ...chunk.relationships.lineServicePlans,
                  { id: 'other-plan-link', lineId: 'other-line', servicePlanId: 'plan' },
                ],
              },
            },
          ],
        }),
      ),
    ).toEqual({ kind: 'rejected', reason: 'ambiguous-line-membership', recordId: 'pattern' });
  });

  it('rejects a membership whose Line entity is absent', () => {
    const chunk = aLineSpanChunk();
    expect(
      prepareLineSpanCandidates(
        aLineSpanProjection({
          chunks: [{ ...chunk, entities: { ...chunk.entities, lines: [] } }],
        }),
      ),
    ).toEqual({ kind: 'rejected', reason: 'missing-line', recordId: 'line' });
  });

  it.each([
    ['missing', [], 'missing-line-order'],
    ['negative', [{ lineId: 'line', rank: -1 }], 'invalid-line-order'],
    ['fractional', [{ lineId: 'line', rank: 0.5 }], 'invalid-line-order'],
    [
      'duplicate Line entry',
      [
        { lineId: 'line', rank: 0 },
        { lineId: 'line', rank: 1 },
      ],
      'invalid-line-order',
    ],
    [
      'duplicate rank',
      [
        { lineId: 'line', rank: 0 },
        { lineId: 'other-line', rank: 0 },
      ],
      'invalid-line-order',
    ],
  ])('rejects %s Line order', (_name, lineOrder, reason) => {
    expect(prepareLineSpanCandidates(aLineSpanProjection({ lineOrder }))).toEqual({
      kind: 'rejected',
      reason,
      recordId: 'line',
    });
  });
});
