import { mapNormalizedRange } from '@transitmapper/core/network/carrier-alignment';
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

describe('visible Line fragments', () => {
  it('tessellates curved carriers and keeps antimeridian geometry continuous', async () => {
    const chunk = aLineSpanChunk();
    const curved = aResolvedCarrier({
      geometry: 'curved',
      points: [
        [179, 0],
        [-179, 0.25],
        [-178, 0],
      ],
      curveControls: [{ pointIndex: 1, radiusMeters: 1_000 }],
    });
    const leg = aResolvedPatternLeg({ carrierFragmentId: curved.id });
    const result = await materializeLine(
      aLineSpanProjection({
        chunks: [
          {
            ...chunk,
            geometry: {
              carriers: [curved],
              patternLegs: [leg],
              visiblePatternLegFragmentIds: [leg.id],
            },
          },
        ],
      }),
    );
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Expected a curved Line fragment.');
    const coordinates = result.visibleFragments[0].geometry.coordinates;
    const lastCoordinate = coordinates.at(-1);
    if (lastCoordinate === undefined) throw new Error('Expected curved Line coordinates.');
    expect(coordinates.length).toBeGreaterThan(3);
    expect(lastCoordinate[0]).toBeGreaterThan(180);
  });

  it('keeps the selected source intact and ignores malformed lower-priority geometry', async () => {
    const chunk = aLineSpanChunk();
    const primary = aResolvedCarrier({
      id: 'primary-carrier',
      alignmentRange: [0, 0.7],
      points: [
        [0, 0],
        [70, 0],
      ],
    });
    const alternate = aResolvedCarrier({
      id: 'alternate-carrier',
      alignmentRange: [0.3, 1],
      points: [
        [30, 1],
        [100, 1],
      ],
    });
    const primaryLeg = aResolvedPatternLeg({
      id: 'primary-source',
      logicalPatternLegFragmentId: 'primary-logical',
      patternId: 'primary-pattern',
      carrierFragmentId: primary.id,
      carrierRange: [0, 0.7],
      logicalCarrierRange: [0, 1],
      logicalAlignmentRange: [0, 1],
    });
    const alternateLeg = aResolvedPatternLeg({
      id: 'alternate-source',
      logicalPatternLegFragmentId: 'alternate-logical',
      patternId: 'alternate-pattern',
      carrierFragmentId: alternate.id,
      carrierRange: [0.3, 1],
      logicalCarrierRange: [0, 1],
      logicalAlignmentRange: [0, 1],
    });
    const result = await materializeLine(
      aLineSpanProjection({
        chunks: [
          {
            ...chunk,
            entities: {
              ...chunk.entities,
              servicePlans: [
                { id: 'a-primary', mode: { kind: 'known', value: 'bus' }, activity: 'active' },
                { id: 'z-alternate', mode: { kind: 'known', value: 'bus' }, activity: 'active' },
              ],
              patterns: [
                { id: primaryLeg.patternId, path: 'known' },
                { id: alternateLeg.patternId, path: 'known' },
              ],
            },
            relationships: {
              ...chunk.relationships,
              lineServicePlans: [
                { id: 'primary-line', lineId: 'line', servicePlanId: 'a-primary' },
                { id: 'alternate-line', lineId: 'line', servicePlanId: 'z-alternate' },
              ],
              servicePlanPatterns: [
                {
                  id: 'primary-pattern-link',
                  servicePlanId: 'a-primary',
                  patternId: primaryLeg.patternId,
                },
                {
                  id: 'alternate-pattern-link',
                  servicePlanId: 'z-alternate',
                  patternId: alternateLeg.patternId,
                },
              ],
            },
            geometry: {
              carriers: [primary, alternate],
              patternLegs: [primaryLeg, alternateLeg],
              visiblePatternLegFragmentIds: [primaryLeg.id, alternateLeg.id],
            },
          },
        ],
      }),
    );
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Expected overlapping Line fragments.');
    expect(
      result.visibleFragments.map(({ canonicalCarrierRange, sourceShardIds }) => ({
        canonicalCarrierRange,
        sourceShardIds,
      })),
    ).toEqual([
      { canonicalCarrierRange: [0, 0.7], sourceShardIds: ['primary-source'] },
      { canonicalCarrierRange: [0.7, 1], sourceShardIds: ['alternate-source'] },
    ]);
  });

  it('selects one source from a large coincident group before constructing geometry', async () => {
    const chunk = aLineSpanChunk();
    const sources = Array.from({ length: 64 }, (_, index) => {
      const id = String(index).padStart(3, '0');
      const carrier = aResolvedCarrier({
        id: `carrier-${id}`,
        alignmentRange: [0, 0.9],
        points: [
          [0, index],
          [90, index],
        ],
        ...(index === 63
          ? {
              geometry: 'curved' as const,
              curveControls: [{ pointIndex: 999, radiusMeters: 1_000 }],
            }
          : {}),
      });
      const leg = aResolvedPatternLeg({
        id: `source-${id}`,
        logicalPatternLegFragmentId: `logical-${id}`,
        patternId: `pattern-${id}`,
        carrierFragmentId: carrier.id,
        carrierRange: [0, 0.9],
        logicalCarrierRange: [0, 1],
        logicalAlignmentRange: [0, 1],
      });
      return { carrier, leg, servicePlanId: `plan-${id}` };
    });
    const tailCarrier = aResolvedCarrier({
      id: 'carrier-tail',
      alignmentRange: [0.9, 1],
      points: [
        [90, 999],
        [100, 999],
      ],
    });
    const tailLeg = aResolvedPatternLeg({
      id: 'source-tail',
      logicalPatternLegFragmentId: 'logical-tail',
      patternId: 'pattern-tail',
      carrierFragmentId: tailCarrier.id,
      carrierRange: [0.9, 1],
      logicalCarrierRange: [0, 1],
      logicalAlignmentRange: [0, 1],
    });
    const result = await materializeLine(
      aLineSpanProjection({
        chunks: [
          {
            ...chunk,
            entities: {
              ...chunk.entities,
              servicePlans: [
                ...sources.map(({ servicePlanId }) => ({
                  id: servicePlanId,
                  mode: { kind: 'known' as const, value: 'bus' },
                  activity: 'active' as const,
                })),
                { id: 'plan-tail', mode: { kind: 'known', value: 'bus' }, activity: 'active' },
              ],
              patterns: [
                ...sources.map(({ leg }) => ({ id: leg.patternId, path: 'known' as const })),
                { id: tailLeg.patternId, path: 'known' },
              ],
            },
            relationships: {
              ...chunk.relationships,
              lineServicePlans: [
                ...sources.map(({ servicePlanId }) => ({
                  id: `line-${servicePlanId}`,
                  lineId: 'line',
                  servicePlanId,
                })),
                { id: 'line-tail', lineId: 'line', servicePlanId: 'plan-tail' },
              ],
              servicePlanPatterns: [
                ...sources.map(({ servicePlanId, leg }) => ({
                  id: `${servicePlanId}-pattern`,
                  servicePlanId,
                  patternId: leg.patternId,
                })),
                {
                  id: 'tail-pattern-link',
                  servicePlanId: 'plan-tail',
                  patternId: tailLeg.patternId,
                },
              ],
            },
            geometry: {
              carriers: [...sources.map(({ carrier }) => carrier), tailCarrier],
              patternLegs: [...sources.map(({ leg }) => leg), tailLeg],
              visiblePatternLegFragmentIds: [...sources.map(({ leg }) => leg.id), tailLeg.id],
            },
          },
        ],
      }),
    );
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Expected coincident short-turn fragments.');
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0].contributors).toHaveLength(65);
    expect(result.visibleFragments.map(({ sourceShardIds }) => sourceShardIds)).toEqual([
      ['source-000'],
      ['source-tail'],
    ]);
  });

  it('maps shared Way source ranges directly into the Alignment range and keeps IDs source-independent', async () => {
    const chunk = aLineSpanChunk();
    const alignmentExtent = [0.1, 0.8] as const;
    const atomRange = [0.20312665884335648, 0.31900899575411434] as const;
    const sourceRange = [0.28956290085955, 0.3] as const;
    const directRange = mapNormalizedRange(sourceRange, [0, 1], alignmentExtent);
    const wayCarrier = aResolvedCarrier({
      id: 'way-carrier',
      carrier: { kind: 'way', id: 'way' },
      alignmentRange: directRange,
      points: [
        [0, 0],
        [1, 0],
      ],
    });
    const wayLeg = aResolvedPatternLeg({
      id: 'way-source',
      logicalPatternLegFragmentId: 'way-logical',
      patternId: 'way-pattern',
      carrierFragmentId: wayCarrier.id,
      carrierRange: sourceRange,
      logicalCarrierRange: [0, 1],
      logicalAlignmentRange: alignmentExtent,
    });
    const boundaryCarrier = aResolvedCarrier({
      id: 'boundary-carrier',
      alignmentRange: atomRange,
      points: [
        [0, 1],
        [1, 1],
      ],
    });
    const boundaryLeg = aResolvedPatternLeg({
      id: 'boundary-source',
      logicalPatternLegFragmentId: 'boundary-logical',
      patternId: 'boundary-pattern',
      carrierFragmentId: boundaryCarrier.id,
      carrierRange: atomRange,
      logicalCarrierRange: atomRange,
      logicalAlignmentRange: atomRange,
    });
    const materialize = async (source: typeof wayLeg) =>
      materializeLine(
        aLineSpanProjection({
          chunks: [
            {
              ...chunk,
              entities: {
                ...chunk.entities,
                servicePlans: [
                  { id: 'a-way', mode: { kind: 'known', value: 'bus' }, activity: 'active' },
                  { id: 'z-boundary', mode: { kind: 'known', value: 'bus' }, activity: 'active' },
                ],
                patterns: [
                  { id: wayLeg.patternId, path: 'known' },
                  { id: boundaryLeg.patternId, path: 'known' },
                ],
                ways: [
                  {
                    id: 'way',
                    alignmentId: 'alignment',
                    alignmentExtent,
                    typeId: 'road',
                    grade: 'atGrade',
                    profile: { lanes: [] },
                  },
                ],
              },
              relationships: {
                ...chunk.relationships,
                lineServicePlans: [
                  { id: 'way-line', lineId: 'line', servicePlanId: 'a-way' },
                  { id: 'boundary-line', lineId: 'line', servicePlanId: 'z-boundary' },
                ],
                servicePlanPatterns: [
                  { id: 'way-pattern-link', servicePlanId: 'a-way', patternId: wayLeg.patternId },
                  {
                    id: 'boundary-pattern-link',
                    servicePlanId: 'z-boundary',
                    patternId: boundaryLeg.patternId,
                  },
                ],
              },
              geometry: {
                carriers: [wayCarrier, boundaryCarrier],
                patternLegs: [source, boundaryLeg],
                visiblePatternLegFragmentIds: [source.id],
              },
            },
          ],
        }),
      );
    const first = await materialize(wayLeg);
    const second = await materialize({ ...wayLeg, id: 'equivalent-way-source' });
    if (first.kind !== 'ready' || second.kind !== 'ready')
      throw new Error('Expected shared Way fragments.');
    expect(first.visibleFragments[0]).toMatchObject({
      canonicalCarrierRange: directRange,
      sourceShardIds: ['way-source'],
    });
    expect(second.visibleFragments[0]).toMatchObject({
      canonicalCarrierRange: directRange,
      sourceShardIds: ['equivalent-way-source'],
    });
    expect(second.visibleFragments[0]?.id).toBe(first.visibleFragments[0]?.id);
  });
});
