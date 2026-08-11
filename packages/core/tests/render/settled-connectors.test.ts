import { describe, expect, it } from 'vitest';
import { buildFeatures } from '../../src/render/buildFeatures';
import { aRoad, aSystem } from '../support/fixtures.test';

describe('settled connector rendering', () => {
  it('does not change committed connector geometry when junction selection changes', () => {
    const eastWest = aRoad('east-west', [
      [-0.01, 0],
      [0, 0],
      [0.01, 0],
    ]);
    const northSouth = aRoad('north-south', [
      [0, -0.01],
      [0, 0],
      [0, 0.01],
    ]);
    const system = aSystem({
      ways: [eastWest, northSouth],
      nodes: [
        {
          id: 'junction',
          coord: [0, 0],
          refs: [
            { wayId: eastWest.id, pointIndex: 1 },
            { wayId: northSouth.id, pointIndex: 1 },
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

    const unselected = buildFeatures(system, null, [], view).connectors;
    const selected = buildFeatures(system, { kind: 'node', id: 'junction' }, [], view).connectors;

    expect(unselected.features).toEqual([]);
    expect(selected).toEqual(unselected);
  });
});
