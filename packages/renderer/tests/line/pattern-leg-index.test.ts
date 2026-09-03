import { describe, expect, it } from 'vitest';
import { preparePatternLegIndex } from '../../src/line/pattern-leg-index';
import { prepareLineSpanInput } from '../../src/line/line-spans';
import { aLineSpanChunk, aLineSpanProjection, aResolvedCarrier } from '../support/line-spans.test';

function preparedInput(projection: ReturnType<typeof aLineSpanProjection>) {
  const result = prepareLineSpanInput(projection.result.chunks);
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') throw new Error('Expected prepared Pattern-leg input.');
  return result.input;
}

describe('Pattern-leg index', () => {
  it('indexes one validated logical path and each supplied shard without copying geometry', () => {
    const chunk = aLineSpanChunk();
    const eastCarrier = aResolvedCarrier({
      id: 'carrier-east',
      alignmentRange: [0.7, 0.9],
      points: [
        [0.2, 0],
        [0.4, 0],
      ],
    });
    const eastLeg = {
      ...chunk.geometry.patternLegs[0],
      id: 'leg-east',
      carrierFragmentId: eastCarrier.id,
      carrierRange: [0.7, 0.9] as const,
    };
    const projection = aLineSpanProjection({
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
    });

    const result = preparePatternLegIndex(projection, preparedInput(projection));

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Expected a prepared Pattern-leg index.');
    expect(result.index.patternLegsByLogicalId).toBeInstanceOf(Map);
    expect(result.index.patternLegShardsById).toBeInstanceOf(Map);
    const patternLeg = result.index.patternLegsByLogicalId.get('logical-leg');
    const eastShard = result.index.patternLegShardsById.get(eastLeg.id);

    expect(patternLeg).toMatchObject({
      logical: { id: 'logical-leg', patternId: 'pattern' },
      alignmentMapping: { kind: 'identity' },
    });
    expect(eastShard?.patternLeg).toBe(patternLeg);
    expect(eastShard?.shard.carrier.points).toBe(eastCarrier.points);
  });

  it('rejects a Way whose asserted logical Alignment range disagrees with its mapping', () => {
    const chunk = aLineSpanChunk();
    const carrier = aResolvedCarrier({ carrier: { kind: 'way', id: 'way', laneId: 'lane' } });
    const projection = aLineSpanProjection({
      chunks: [
        {
          ...chunk,
          entities: {
            ...chunk.entities,
            ways: [
              {
                id: 'way',
                alignmentId: 'alignment',
                alignmentExtent: [0.25, 0.75],
                typeId: 'road',
                grade: 'atGrade',
                profile: {
                  lanes: [{ id: 'lane', kindId: 'bus', widthMeters: 3, direction: 'both' }],
                },
              },
            ],
          },
          geometry: { ...chunk.geometry, carriers: [carrier] },
        },
      ],
    });

    expect(preparePatternLegIndex(projection, preparedInput(projection))).toEqual({
      kind: 'rejected',
      reason: 'way-alignment-range-conflict',
      recordId: 'logical-leg',
    });
  });
});
