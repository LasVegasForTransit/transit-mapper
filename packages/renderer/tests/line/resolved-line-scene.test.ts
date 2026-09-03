import { describe, expect, it } from 'vitest';
import {
  renderDomainIdentity,
  systemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { projectResolvedLineScene } from '../../src/line/resolved-line-scene';
import {
  aLineSpanChunk,
  aLineSpanResult,
  aResolvedCarrier,
  aResolvedPatternLeg,
  lineSpanPresentation,
} from '../support/line-spans.test';

const scenePresentation = renderPresentationForViewport({
  center: [0, 0],
  zoom: 12,
  width: 1_280,
  height: 720,
});

function lineStripeFeatures(projected: Awaited<ReturnType<typeof projectResolvedLineScene>>) {
  return [...projected.scene.featuresBySource.values()]
    .flatMap((collection) => collection.features)
    .filter((feature) => feature.properties?.routeRole === 'stripe');
}

function stringProperty(properties: unknown, key: string): string | undefined {
  if (properties === null || typeof properties !== 'object') return undefined;
  const value = (properties as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

describe('resolved Line scene', () => {
  it('projects host-resolved network facts into a Line-owned render scene', async () => {
    const sourceId = systemFeatureSourceId('line-visuals');
    const projected = await projectResolvedLineScene({
      result: aLineSpanResult(),
      presentation: lineSpanPresentation,
      sceneRevision: 'line-scene-test',
      sourceId,
    });

    const features = projected.scene.featuresBySource.get(sourceId)?.features ?? [];
    const stripes = features.filter((feature) => feature.properties?.routeRole === 'stripe');
    const casings = features.filter((feature) => feature.properties?.routeRole === 'casing');

    expect(casings).toHaveLength(1);
    expect(stripes).toHaveLength(1);
    expect(stripes[0]?.properties?.lineId).toBe('line');
    expect(projected.scene.identityIndex.renderFeatureIdsByDomain.size).toBe(1);
    expect(projected.lineSpanIdsByLineId.get('line')).toHaveLength(1);
  });

  it('paints a Line once on each short-turn span while binding both spans to the Line', async () => {
    const source = aLineSpanChunk();
    const shortTurnCarrier = aResolvedCarrier({
      id: 'short-turn-carrier',
      alignmentRange: [0, 0.5],
      points: [
        [0, 0],
        [0.5, 0],
      ],
    });
    const fullLengthCarrier = aResolvedCarrier({
      id: 'full-length-carrier',
      alignmentRange: [0, 1],
      points: [
        [0, 0],
        [1, 0],
      ],
    });
    const shortTurn = aResolvedPatternLeg({
      id: 'short-turn-leg',
      logicalPatternLegFragmentId: 'short-turn-logical-leg',
      patternId: 'short-turn-pattern',
      carrierFragmentId: shortTurnCarrier.id,
      carrierRange: [0, 0.5],
      logicalCarrierRange: [0, 0.5],
      logicalAlignmentRange: [0, 0.5],
    });
    const fullLength = aResolvedPatternLeg({
      id: 'full-length-leg',
      logicalPatternLegFragmentId: 'full-length-logical-leg',
      patternId: 'full-length-pattern',
      carrierFragmentId: fullLengthCarrier.id,
      carrierRange: [0, 1],
      logicalCarrierRange: [0, 1],
      logicalAlignmentRange: [0, 1],
    });

    const projected = await projectResolvedLineScene({
      result: aLineSpanResult({
        chunks: [
          {
            ...source,
            entities: {
              ...source.entities,
              servicePlans: [
                {
                  id: 'short-turn-plan',
                  mode: { kind: 'known', value: 'bus' },
                  activity: 'active',
                },
                {
                  id: 'full-length-plan',
                  mode: { kind: 'known', value: 'bus' },
                  activity: 'active',
                },
              ],
              patterns: [
                { id: shortTurn.patternId, path: 'known' },
                { id: fullLength.patternId, path: 'known' },
              ],
            },
            relationships: {
              ...source.relationships,
              lineServicePlans: [
                { id: 'line-short-turn', lineId: 'line', servicePlanId: 'short-turn-plan' },
                { id: 'line-full-length', lineId: 'line', servicePlanId: 'full-length-plan' },
              ],
              servicePlanPatterns: [
                {
                  id: 'short-turn-plan-pattern',
                  servicePlanId: 'short-turn-plan',
                  patternId: shortTurn.patternId,
                },
                {
                  id: 'full-length-plan-pattern',
                  servicePlanId: 'full-length-plan',
                  patternId: fullLength.patternId,
                },
              ],
            },
            geometry: {
              carriers: [shortTurnCarrier, fullLengthCarrier],
              patternLegs: [shortTurn, fullLength],
              visiblePatternLegFragmentIds: [shortTurn.id, fullLength.id],
            },
          },
        ],
      }),
      presentation: scenePresentation,
      sceneRevision: 'short-turn',
      sourceId: systemFeatureSourceId('line-visuals'),
    });

    const stripes = lineStripeFeatures(projected);
    expect(stripes).toHaveLength(2);
    expect(stripes.map((feature) => stringProperty(feature.properties, 'lineId'))).toEqual([
      'line',
      'line',
    ]);
    expect(
      stripes.map((feature) =>
        feature.geometry.type === 'LineString' ? feature.geometry.coordinates : undefined,
      ),
    ).toEqual([
      [
        [0, 0],
        [0.5, 0],
      ],
      [
        [0.5, 0],
        [1, 0],
      ],
    ]);
    expect(
      projected.scene.identityIndex.renderFeatureIdsByDomain.get(
        renderDomainIdentity('line', 'line'),
      ),
    ).toHaveLength(2);
    expect(projected.contributorsByLineId.get('line')).toEqual([
      expect.objectContaining({
        servicePlanId: 'full-length-plan',
        patternId: 'full-length-pattern',
      }),
      expect.objectContaining({
        servicePlanId: 'short-turn-plan',
        patternId: 'short-turn-pattern',
      }),
    ]);
  });

  it('keeps a temporary replacement plan in Line contributors without painting another stripe', async () => {
    const source = aLineSpanChunk();
    const carrier = aResolvedCarrier({
      id: 'carrier',
      alignmentRange: [0, 1],
      points: [
        [0, 0],
        [1, 0],
      ],
    });
    const regular = aResolvedPatternLeg({
      id: 'regular-leg',
      logicalPatternLegFragmentId: 'regular-logical-leg',
      patternId: 'regular-pattern',
      carrierFragmentId: carrier.id,
      carrierRange: [0, 1],
      logicalCarrierRange: [0, 1],
      logicalAlignmentRange: [0, 1],
    });
    const temporary = aResolvedPatternLeg({
      id: 'temporary-leg',
      logicalPatternLegFragmentId: 'temporary-logical-leg',
      patternId: 'temporary-pattern',
      carrierFragmentId: carrier.id,
      carrierRange: [0, 1],
      logicalCarrierRange: [0, 1],
      logicalAlignmentRange: [0, 1],
    });

    const projected = await projectResolvedLineScene({
      result: aLineSpanResult({
        chunks: [
          {
            ...source,
            entities: {
              ...source.entities,
              servicePlans: [
                { id: 'regular-plan', mode: { kind: 'known', value: 'bus' }, activity: 'active' },
                {
                  id: 'temporary-replacement-plan',
                  mode: { kind: 'known', value: 'bus' },
                  activity: 'active',
                },
              ],
              patterns: [
                { id: regular.patternId, path: 'known' },
                { id: temporary.patternId, path: 'known' },
              ],
            },
            relationships: {
              ...source.relationships,
              lineServicePlans: [
                { id: 'line-regular', lineId: 'line', servicePlanId: 'regular-plan' },
                {
                  id: 'line-temporary-replacement',
                  lineId: 'line',
                  servicePlanId: 'temporary-replacement-plan',
                },
              ],
              servicePlanPatterns: [
                {
                  id: 'regular-plan-pattern',
                  servicePlanId: 'regular-plan',
                  patternId: regular.patternId,
                },
                {
                  id: 'temporary-plan-pattern',
                  servicePlanId: 'temporary-replacement-plan',
                  patternId: temporary.patternId,
                },
              ],
              replacements: [
                {
                  id: 'temporary-replaces-regular',
                  replacement: { kind: 'service-plan', id: 'temporary-replacement-plan' },
                  target: { kind: 'service-plan', id: 'regular-plan' },
                },
              ],
            },
            geometry: {
              carriers: [carrier],
              patternLegs: [regular, temporary],
              visiblePatternLegFragmentIds: [regular.id, temporary.id],
            },
          },
        ],
      }),
      presentation: scenePresentation,
      sceneRevision: 'temporary-replacement',
      sourceId: systemFeatureSourceId('line-visuals'),
    });

    const stripes = lineStripeFeatures(projected);
    expect(stripes).toHaveLength(1);
    expect(stripes[0]?.properties?.lineId).toBe('line');
    expect(
      stripes[0]?.geometry.type === 'LineString' ? stripes[0].geometry.coordinates : undefined,
    ).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(
      projected.scene.identityIndex.renderFeatureIdsByDomain.get(
        renderDomainIdentity('line', 'line'),
      ),
    ).toHaveLength(1);
    expect(projected.contributorsByLineId.get('line')).toEqual([
      expect.objectContaining({ servicePlanId: 'regular-plan', patternId: 'regular-pattern' }),
      expect.objectContaining({
        servicePlanId: 'temporary-replacement-plan',
        patternId: 'temporary-pattern',
      }),
    ]);
  });
});
