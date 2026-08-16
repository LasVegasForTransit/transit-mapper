import type { Feature } from 'geojson';
import { describe, expect, it } from 'vitest';
import { buildFeatures } from '../../src/render/buildFeatures';
import { aRoad, aSystem } from '../support/fixtures.test';

function featureProperty(feature: Feature, name: string): unknown {
  return feature.properties?.[name];
}

describe('settled connector rendering', () => {
  it('renders permitted lane movements without requiring junction selection', () => {
    const east = aRoad('east', [
      [0, 0],
      [0.01, 0],
    ]);
    const west = aRoad('west', [
      [0, 0],
      [-0.01, 0],
    ]);
    const north = aRoad('north', [
      [0, 0],
      [0, 0.01],
    ]);
    const system = aSystem({
      ways: [east, west, north],
      nodes: [
        {
          id: 'junction',
          coord: [0, 0],
          refs: [
            { wayId: east.id, pointIndex: 0 },
            { wayId: west.id, pointIndex: 0 },
            { wayId: north.id, pointIndex: 0 },
          ],
        },
      ],
    });
    const view = {
      viewMode: 'infrastructure' as const,
      visibleModes: new Set<string>(),
      visibleWayTypes: new Set(['road']),
      presentation: {
        bounds: {
          southwest: [-0.02, -0.02] as [number, number],
          northeast: [0.02, 0.02] as [number, number],
        },
        zoom: 18,
        viewportWidthPx: 800,
        viewportHeightPx: 600,
        displayedWidthPx: 800,
        displayedHeightPx: 600,
        pixelRatio: 1,
      },
    };

    const unselectedFeatures = buildFeatures(system, null, [], view);
    const selected = buildFeatures(system, { kind: 'node', id: 'junction' }, [], view).connectors;
    const unselected = unselectedFeatures.connectors;

    expect(unselected.features).not.toEqual([]);
    expect(
      unselected.features.some(
        (feature) =>
          featureProperty(feature, 'nodeId') === 'junction' &&
          featureProperty(feature, 'renderTier') === 'street',
      ),
    ).toBe(true);
    expect(selected).toEqual(unselected);
  });
});
