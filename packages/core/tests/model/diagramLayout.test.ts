import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '../../src/model/serialize';
import type { TransitSystem } from '../../src/model/system';
import { computeDiagramSystem } from '../../src/model/diagramLayout';

function fixture(): TransitSystem {
  return {
    ...createEmptySystem(1),
    ways: [
      {
        id: 'way',
        typeId: 'road',
        points: [
          [-115.2, 36.1],
          [-115.12, 36.13],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        profile: { lanes: [] },
      },
    ],
    stops: [
      {
        id: 'stop',
        coord: [-115.16, 36.115],
        anchors: [{ wayId: 'way', t: 0.5 }],
      },
    ],
  };
}

function operationCounts() {
  return {
    diagramTopologyBuildCount: 0,
    diagramTopologyCacheHitCount: 0,
    diagramStopBuildCount: 0,
    diagramStopCacheHitCount: 0,
  };
}

describe('diagram layout dependency cache', () => {
  it('reuses schematic ways and stops when a non-layout field changes', () => {
    const system = fixture();
    const counts = operationCounts();
    const first = computeDiagramSystem(system, counts);

    const second = computeDiagramSystem(
      {
        ...system,
        facilities: [{ id: 'entrance', typeId: 'entrance', geometry: [-115.16, 36.116] }],
      },
      counts,
    );

    expect(second.ways).toBe(first.ways);
    expect(second.stops).toBe(first.stops);
    expect(second.facilities).toHaveLength(1);
    expect(counts).toEqual({
      diagramTopologyBuildCount: 1,
      diagramTopologyCacheHitCount: 1,
      diagramStopBuildCount: 1,
      diagramStopCacheHitCount: 1,
    });
  });

  it('reuses schematic topology while rebuilding only changed stop placement', () => {
    const system = fixture();
    const counts = operationCounts();
    const first = computeDiagramSystem(system, counts);
    const changedStops = system.stops.map((stop) => ({
      ...stop,
      name: 'Renamed stop',
    }));

    const second = computeDiagramSystem({ ...system, stops: changedStops }, counts);

    expect(second.ways).toBe(first.ways);
    expect(second.stops).not.toBe(first.stops);
    expect(second.stops[0]?.name).toBe('Renamed stop');
    expect(counts).toEqual({
      diagramTopologyBuildCount: 1,
      diagramTopologyCacheHitCount: 1,
      diagramStopBuildCount: 2,
      diagramStopCacheHitCount: 0,
    });
  });
});
