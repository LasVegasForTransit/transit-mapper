import { describe, expect, it } from 'vitest';
import { aRoad, aSystem } from '@transitmapper/core/testing/fixtures';
import type { LngLat } from '@transitmapper/core/model/system';
import { selectedJunctionConnectorFeatures } from '../../src/map/editor-overlays';

const junction: LngLat = [-115.19, 36.1];
const ways = [
  aRoad('west', [[-115.2, 36.1], junction]),
  aRoad('east', [junction, [-115.18, 36.1]]),
  aRoad('south', [[-115.19, 36.09], junction]),
  aRoad('north', [junction, [-115.19, 36.11]]),
];
const system = aSystem({
  ways,
  nodes: [
    {
      id: 'junction-a',
      coord: junction,
      refs: [
        { wayId: 'west', pointIndex: 1 },
        { wayId: 'east', pointIndex: 0 },
        { wayId: 'south', pointIndex: 1 },
        { wayId: 'north', pointIndex: 0 },
      ],
    },
  ],
});

describe('selected junction connector projection', () => {
  it('derives only the selected junction guides with deterministic stable IDs', () => {
    const first = selectedJunctionConnectorFeatures(system, 'junction-a');
    const second = selectedJunctionConnectorFeatures(system, 'junction-a');

    expect(first.features.length).toBeGreaterThan(0);
    expect(first.features.every((feature) => feature.properties?.nodeId === 'junction-a')).toBe(
      true,
    );
    expect(first.features.every((feature) => feature.properties?.renderTier === 'street')).toBe(
      true,
    );
    expect(first.features.map((feature) => feature.id)).toEqual(
      second.features.map((feature) => feature.id),
    );
    expect(new Set(first.features.map((feature) => feature.id)).size).toBe(first.features.length);
  });

  it('clears the lightweight guide source without a selected junction', () => {
    expect(selectedJunctionConnectorFeatures(system, null).features).toEqual([]);
    expect(selectedJunctionConnectorFeatures(system, 'missing').features).toEqual([]);
  });
});
