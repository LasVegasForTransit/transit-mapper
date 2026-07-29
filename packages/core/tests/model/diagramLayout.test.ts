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
    stations: [
      {
        id: 'station',
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
    diagramStationBuildCount: 0,
    diagramStationCacheHitCount: 0,
  };
}

describe('diagram layout dependency cache', () => {
  it('reuses schematic ways and stations when a non-layout field changes', () => {
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
    expect(second.stations).toBe(first.stations);
    expect(second.facilities).toHaveLength(1);
    expect(counts).toEqual({
      diagramTopologyBuildCount: 1,
      diagramTopologyCacheHitCount: 1,
      diagramStationBuildCount: 1,
      diagramStationCacheHitCount: 1,
    });
  });

  it('reuses schematic topology while rebuilding only changed station placement', () => {
    const system = fixture();
    const counts = operationCounts();
    const first = computeDiagramSystem(system, counts);
    const changedStations = system.stations.map((station) => ({
      ...station,
      name: 'Renamed station',
    }));

    const second = computeDiagramSystem({ ...system, stations: changedStations }, counts);

    expect(second.ways).toBe(first.ways);
    expect(second.stations).not.toBe(first.stations);
    expect(second.stations[0]?.name).toBe('Renamed station');
    expect(counts).toEqual({
      diagramTopologyBuildCount: 1,
      diagramTopologyCacheHitCount: 1,
      diagramStationBuildCount: 2,
      diagramStationCacheHitCount: 0,
    });
  });
});
