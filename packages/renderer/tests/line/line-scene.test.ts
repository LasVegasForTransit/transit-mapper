import { describe, expect, it } from 'vitest';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import { projectLineScene } from '../../src/line/line-scene';

function stringProperty(
  feature: { readonly properties: unknown },
  key: string,
): string | undefined {
  if (!feature.properties || typeof feature.properties !== 'object') return undefined;
  const value = (feature.properties as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

describe('Line scene', () => {
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

    const scene = await projectLineScene({ system });
    const casings = scene.features.features.filter(
      (feature) => feature.properties?.routeRole === 'casing',
    );
    const stripes = scene.features.features.filter(
      (feature) => feature.properties?.routeRole === 'stripe',
    );

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
    expect(scene.features.features.some((feature) => feature.properties?.hitTarget === true)).toBe(
      false,
    );
    for (const feature of scene.features.features) {
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

    const scene = await projectLineScene({ system });
    const casings = scene.features.features.filter(
      (feature) => feature.properties?.routeRole === 'casing',
    );
    const stripes = scene.features.features.filter(
      (feature) => feature.properties?.routeRole === 'stripe',
    );

    expect(casings).toHaveLength(1);
    expect(stripes).toHaveLength(1);
    expect(stringProperty(stripes[0]!, 'lineId')).toBe('shared-line');
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

    const scene = await projectLineScene({ system });

    expect(
      scene.features.features.filter((feature) => feature.properties?.routeRole === 'casing'),
    ).toHaveLength(1);
    const [stripe] = scene.features.features.filter(
      (feature) => feature.properties?.routeRole === 'stripe',
    );
    expect(stringProperty(stripe, 'lineId')).toBe('singleton-line');
    expect(stringProperty(stripe, 'color')).toBe('#123456');
  });
});
