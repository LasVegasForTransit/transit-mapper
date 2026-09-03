import { describe, expect, it } from 'vitest';
import { materializeExactLineSpans } from '../../src/line/line-span-materialization';
import { prepareLineSpanCandidates } from '../../src/line/line-span-candidates';
import {
  aLineSpanChunk,
  aLineSpanProjection,
  aResolvedCarrier,
  aResolvedPatternLeg,
} from '../support/line-spans.test';

async function materializeLine(projection: ReturnType<typeof aLineSpanProjection>) {
  const prepared = prepareLineSpanCandidates(projection);
  if (prepared.kind !== 'ready') throw new Error('Expected prepared Line candidates.');
  return materializeExactLineSpans({
    context: prepared.context,
    lineId: 'line',
    carrierRule: 'shared-alignment',
  });
}

describe('exact Line span materialization', () => {
  it('keeps one semantic span while retaining its visible source fragment', async () => {
    const result = await materializeLine(aLineSpanProjection());
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Expected a materialized Line span.');
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]).toMatchObject({
      lineId: 'line',
      canonicalCarrier: { kind: 'alignment', id: 'alignment' },
      canonicalCarrierRange: [0, 1],
      contributors: [{ servicePlanId: 'plan', patternId: 'pattern', legIndex: 0 }],
    });
    expect(result.visibleFragments).toEqual([
      expect.objectContaining({
        lineSpanId: result.spans[0]?.id,
        canonicalCarrierRange: [0.25, 0.75],
        sourceShardIds: ['leg-shard'],
        geometry: {
          type: 'LineString',
          coordinates: [
            [-0.5, 0],
            [0.5, 0],
          ],
        },
      }),
    ]);
  });

  it('keeps Line identity stable when one visible carrier arrives in two shards', async () => {
    const baseline = await materializeLine(aLineSpanProjection());
    if (baseline.kind !== 'ready') throw new Error('Expected a baseline Line span.');
    const chunk = aLineSpanChunk();
    const westCarrier = aResolvedCarrier({
      id: 'carrier-west',
      alignmentRange: [0.25, 0.5],
      points: [
        [-0.5, 0],
        [0, 0],
      ],
    });
    const eastCarrier = aResolvedCarrier({
      id: 'carrier-east',
      alignmentRange: [0.5, 0.75],
      points: [
        [0, 0],
        [0.5, 0],
      ],
    });
    const westLeg = aResolvedPatternLeg({
      id: 'leg-west',
      carrierFragmentId: westCarrier.id,
      carrierRange: [0.25, 0.5],
    });
    const eastLeg = aResolvedPatternLeg({
      id: 'leg-east',
      carrierFragmentId: eastCarrier.id,
      carrierRange: [0.5, 0.75],
    });
    const split = await materializeLine(
      aLineSpanProjection({
        chunks: [
          {
            ...chunk,
            geometry: {
              carriers: [westCarrier, eastCarrier],
              patternLegs: [westLeg, eastLeg],
              visiblePatternLegFragmentIds: [westLeg.id, eastLeg.id],
            },
          },
        ],
      }),
    );
    expect(split.kind).toBe('ready');
    if (split.kind !== 'ready') throw new Error('Expected split visible Line spans.');
    expect(split.spans[0]?.id).toBe(baseline.spans[0]?.id);
    expect(
      split.visibleFragments.map(({ canonicalCarrierRange }) => canonicalCarrierRange),
    ).toEqual([
      [0.25, 0.5],
      [0.5, 0.75],
    ]);
  });

  it('uses visible sibling evidence when the canonical contributor is closure-only', async () => {
    const chunk = aLineSpanChunk();
    const closureCarrier = aResolvedCarrier({ id: 'closure-carrier' });
    const closureLeg = aResolvedPatternLeg({
      id: 'closure-leg',
      logicalPatternLegFragmentId: 'closure-logical-leg',
      patternId: 'closure-pattern',
      carrierFragmentId: closureCarrier.id,
    });
    const result = await materializeLine(
      aLineSpanProjection({
        chunks: [
          {
            ...chunk,
            entities: {
              ...chunk.entities,
              servicePlans: [
                ...chunk.entities.servicePlans,
                { id: 'a-closure', mode: { kind: 'known', value: 'bus' }, activity: 'active' },
              ],
              patterns: [...chunk.entities.patterns, { id: 'closure-pattern', path: 'known' }],
            },
            relationships: {
              ...chunk.relationships,
              lineServicePlans: [
                ...chunk.relationships.lineServicePlans,
                { id: 'line-closure', lineId: 'line', servicePlanId: 'a-closure' },
              ],
              servicePlanPatterns: [
                ...chunk.relationships.servicePlanPatterns,
                {
                  id: 'closure-pattern-link',
                  servicePlanId: 'a-closure',
                  patternId: 'closure-pattern',
                },
              ],
            },
            geometry: {
              carriers: [...chunk.geometry.carriers, closureCarrier],
              patternLegs: [...chunk.geometry.patternLegs, closureLeg],
              visiblePatternLegFragmentIds: ['leg-shard'],
            },
          },
        ],
      }),
    );
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Expected closure-aware Line spans.');
    expect(result.spans[0]?.contributors.map(({ servicePlanId }) => servicePlanId)).toEqual([
      'a-closure',
      'plan',
    ]);
    expect(result.visibleFragments[0]?.sourceShardIds).toEqual(['leg-shard']);
  });
});
