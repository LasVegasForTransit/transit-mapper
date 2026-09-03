import { describe, expect, it } from 'vitest';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import {
  lineSceneFeatures,
  projectSchemaV16LineScene,
  usesPassengerLineScene,
} from '../../src/line/line-scene';

function stringProperty(
  feature: { readonly properties: unknown },
  key: string,
): string | undefined {
  if (!feature.properties || typeof feature.properties !== 'object') return undefined;
  const value = (feature.properties as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** Every fixture below sits on one short corridor near downtown Las Vegas.
 * The scene resolves from the live map query, so a case that does not frame
 * its own geometry would assert against an empty result. */
function aCameraOverTheFixtures(): RenderViewOptions {
  return {
    viewMode: 'network',
    visibleModes: new Set(['bus']),
    visibleWayTypes: new Set(['road']),
    presentation: renderPresentationForViewport({
      center: [-115.18, 36.14],
      zoom: 14,
      width: 1_280,
      height: 720,
    }),
  };
}

async function stripedFeatures(system: TransitSystem) {
  const scene = await projectSchemaV16LineScene({
    system,
    view: aCameraOverTheFixtures(),
    sceneRevision: 'current-map-query',
  });
  return lineSceneFeatures(scene).features;
}

describe('Line scene', () => {
  it('uses passenger Lines in Network and Diagram but not Infrastructure', () => {
    expect(usesPassengerLineScene('network')).toBe(true);
    expect(usesPassengerLineScene('diagram')).toBe(true);
    expect(usesPassengerLineScene('infrastructure')).toBe(false);
  });

  it('resolves only the current camera bounds and mode selection', async () => {
    const busWay = aRoad('bus-way', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const railWay = aRoad('rail-way', [
      [-112.2, 36.14],
      [-112.16, 36.14],
    ]);
    const bus = aService('bus-service', [aPattern('bus-pattern', [busWay], [busWay.id])]);
    const rail = aService('rail-service', [aPattern('rail-pattern', [railWay], [railWay.id])], {
      modeId: 'lightRail',
    });
    const system = aSystem({
      ways: [busWay, railWay],
      services: [bus, rail],
      lines: [
        { id: 'bus-line', name: 'Bus', color: '#00a8e8', serviceIds: [bus.id] },
        { id: 'rail-line', name: 'Rail', color: '#e4572e', serviceIds: [rail.id] },
      ],
    });

    const projected = await projectSchemaV16LineScene({
      system,
      view: aCameraOverTheFixtures(),
      sceneRevision: 'current-map-query',
    });
    const features = [...projected.scene.featuresBySource.values()].flatMap(
      (collection) => collection.features,
    );
    const stripes = features.filter((feature) => feature.properties?.routeRole === 'stripe');

    expect(stripes.map((feature) => stringProperty(feature, 'lineId'))).toEqual(['bus-line']);
  });

  it('renders one casing and ordered Line stripes for a shared corridor', async () => {
    const way = aRoad('shared-way', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const first = aService('first-service', [aPattern('first-pattern', [way], [way.id])]);
    const second = aService('second-service', [aPattern('second-pattern', [way], [way.id])]);
    const system = aSystem({
      ways: [way],
      services: [first, second],
      lines: [
        { id: 'first-line', name: 'First', color: '#123456', serviceIds: [first.id] },
        { id: 'second-line', name: 'Second', color: '#abcdef', serviceIds: [second.id] },
      ],
    });

    const features = await stripedFeatures(system);
    const casings = features.filter((feature) => feature.properties?.routeRole === 'casing');
    const stripes = features.filter((feature) => feature.properties?.routeRole === 'stripe');

    expect(casings).toHaveLength(1);
    expect(casings[0]?.properties).not.toHaveProperty('lineId');
    expect(stripes.map((feature) => stringProperty(feature, 'lineId'))).toEqual([
      'first-line',
      'second-line',
    ]);
    expect(stripes.map((feature) => stringProperty(feature, 'color'))).toEqual([
      '#123456',
      '#abcdef',
    ]);
    expect(stripes.every((feature) => typeof feature.id === 'string')).toBe(true);
    expect(features.some((feature) => feature.properties?.hitTarget === true)).toBe(false);
    for (const feature of features) {
      for (const property of ['serviceId', 'patternId', 'wayId', 'modeId', 'typeId']) {
        expect(feature.properties).not.toHaveProperty(property);
      }
    }
  });

  it('renders multiple Services in one Line as one passenger stripe on a shared carrier', async () => {
    const way = aRoad('shared-carrier', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const local = aService('local-service', [aPattern('local-pattern', [way], [way.id])]);
    const express = aService('express-service', [aPattern('express-pattern', [way], [way.id])]);
    const system = aSystem({
      ways: [way],
      services: [local, express],
      lines: [
        {
          id: 'shared-line',
          name: 'Shared line',
          color: '#123456',
          serviceIds: [local.id, express.id],
        },
      ],
    });

    const features = await stripedFeatures(system);
    const casings = features.filter((feature) => feature.properties?.routeRole === 'casing');
    const stripes = features.filter((feature) => feature.properties?.routeRole === 'stripe');

    expect(casings).toHaveLength(1);
    expect(stripes).toHaveLength(1);
    const [stripe] = stripes;
    expect(stringProperty(stripe, 'lineId')).toBe('shared-line');
  });

  it('keeps a singleton Line as one casing and one stripe', async () => {
    const way = aRoad('singleton-way', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const service = aService('singleton-service', [aPattern('singleton-pattern', [way], [way.id])]);
    const system = aSystem({
      ways: [way],
      services: [service],
      lines: [
        { id: 'singleton-line', name: 'Singleton', color: '#123456', serviceIds: [service.id] },
      ],
    });

    const features = await stripedFeatures(system);

    expect(features.filter((feature) => feature.properties?.routeRole === 'casing')).toHaveLength(
      1,
    );
    const [stripe] = features.filter((feature) => feature.properties?.routeRole === 'stripe');
    expect(stringProperty(stripe, 'lineId')).toBe('singleton-line');
    expect(stringProperty(stripe, 'color')).toBe('#123456');
  });
});
