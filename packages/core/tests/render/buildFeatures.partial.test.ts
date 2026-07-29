import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '../../src/model/serialize';
import type { TransitSystem } from '../../src/model/system';
import { buildFeatures, type SystemFeatures } from '../../src/render/buildFeatures';

const view = {
  viewMode: 'infrastructure' as const,
  visibleModes: new Set(['bus']),
  visibleWayTypes: new Set(['road']),
};

function fixture(): TransitSystem {
  return {
    ...createEmptySystem(1),
    ways: [
      {
        id: 'road',
        typeId: 'road',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        profile: {
          lanes: [{ id: 'road-lane', kindId: 'drive', widthM: 3.3, direction: 'both' }],
        },
      },
    ],
    services: [
      {
        id: 'route',
        name: 'Route',
        modeId: 'bus',
        color: '#2ea44f',
        patterns: [
          {
            id: 'route-pattern',
            sections: [
              {
                kind: 'shared',
                legs: [
                  {
                    wayId: 'road',
                    direction: 'withPoints',
                    extent: { kind: 'whole' },
                    lane: { kind: 'auto' },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    stations: [
      {
        id: 'station',
        name: 'Station',
        coord: [-115.15, 36.1],
        anchors: [{ wayId: 'road', t: 0.5 }],
        footprint: [
          [-115.151, 36.099],
          [-115.149, 36.099],
          [-115.149, 36.101],
        ],
        platforms: [
          {
            id: 'platform',
            points: [
              [-115.1505, 36.0995],
              [-115.1495, 36.0995],
              [-115.1495, 36.1005],
            ],
          },
        ],
      },
    ],
    facilities: [
      {
        id: 'facility',
        typeId: 'entrance',
        geometry: [-115.15, 36.1005],
      },
    ],
    groups: [
      {
        id: 'group',
        memberIds: ['station', 'facility'],
        footprint: [
          [-115.152, 36.098],
          [-115.148, 36.098],
          [-115.148, 36.102],
        ],
      },
    ],
    namedWays: [{ id: 'named-road', name: 'Main Street', wayIds: ['road'] }],
  };
}

function operationCounts() {
  return {
    featureCollectionBuildCount: 0,
    featureTopologyPassCount: 0,
    featureTopologyWayVisitCount: 0,
    featureJunctionPassCount: 0,
    featureJunctionNodeVisitCount: 0,
    featureStationPassCount: 0,
    featureStationVisitCount: 0,
    featureHandlePassCount: 0,
    featureHandleWayVisitCount: 0,
    featurePhysicalPassCount: 0,
    featurePhysicalStationVisitCount: 0,
    featurePhysicalGroupVisitCount: 0,
    featureFacilityPassCount: 0,
    featureFacilityVisitCount: 0,
    featureWayLabelPassCount: 0,
    featureNamedWayVisitCount: 0,
    featureLaneGeometryBuildCount: 0,
  };
}

function expectEmptyExcept(
  features: SystemFeatures,
  expectedNonEmpty: readonly (keyof SystemFeatures)[],
): void {
  const expected = new Set(expectedNonEmpty);
  for (const [name, collection] of Object.entries(features) as [
    keyof SystemFeatures,
    SystemFeatures[keyof SystemFeatures],
  ][]) {
    if (expected.has(name)) expect(collection.features.length, name).toBeGreaterThan(0);
    else expect(collection.features, name).toEqual([]);
  }
}

describe('partial system feature projection', () => {
  it('builds a facility source without visiting topology, stations, or labels', () => {
    const system = fixture();
    const full = buildFeatures(system, null, [], view);
    const counts = operationCounts();

    const projected = buildFeatures(system, null, [], view, null, null, {
      requestedFeatures: ['facilities'],
      counts,
    });

    expect(projected.facilities).toEqual(full.facilities);
    expectEmptyExcept(projected, ['facilities']);
    expect(counts).toMatchObject({
      featureCollectionBuildCount: 1,
      featureTopologyPassCount: 0,
      featureTopologyWayVisitCount: 0,
      featureStationPassCount: 0,
      featureStationVisitCount: 0,
      featurePhysicalPassCount: 0,
      featureFacilityPassCount: 1,
      featureFacilityVisitCount: 1,
      featureWayLabelPassCount: 0,
      featureNamedWayVisitCount: 0,
      featureLaneGeometryBuildCount: 0,
    });
  });

  it('builds station and physical sources without running unrelated topology builders', () => {
    const system = fixture();
    const full = buildFeatures(system, null, [], view, 'station', 'group');
    const counts = operationCounts();

    const projected = buildFeatures(system, null, [], view, 'station', 'group', {
      requestedFeatures: ['stations', 'footprints', 'platforms', 'physicalHandles'],
      counts,
    });

    expect(projected.stations).toEqual(full.stations);
    expect(projected.footprints).toEqual(full.footprints);
    expect(projected.platforms).toEqual(full.platforms);
    expect(projected.physicalHandles).toEqual(full.physicalHandles);
    expectEmptyExcept(projected, ['stations', 'footprints', 'platforms', 'physicalHandles']);
    expect(counts).toMatchObject({
      featureCollectionBuildCount: 4,
      featureTopologyPassCount: 0,
      featureTopologyWayVisitCount: 0,
      featureStationPassCount: 1,
      featureStationVisitCount: 1,
      featurePhysicalPassCount: 1,
      featurePhysicalStationVisitCount: 1,
      featurePhysicalGroupVisitCount: 1,
      featureFacilityPassCount: 0,
      featureWayLabelPassCount: 0,
      featureLaneGeometryBuildCount: 0,
    });
  });

  it('builds service-dependent sources without allocating physical detail or way labels', () => {
    const system = fixture();
    const full = buildFeatures(system, null, ['road'], view);
    const counts = operationCounts();
    const requested: (keyof SystemFeatures)[] = [
      'ways',
      'services',
      'stations',
      'handles',
      'laneArrows',
      'serviceArrows',
    ];

    const projected = buildFeatures(system, null, ['road'], view, null, null, {
      requestedFeatures: requested,
      counts,
    });

    for (const name of requested) expect(projected[name]).toEqual(full[name]);
    expectEmptyExcept(projected, ['ways', 'services', 'stations', 'handles']);
    expect(counts).toMatchObject({
      featureCollectionBuildCount: 6,
      featureTopologyPassCount: 1,
      featureTopologyWayVisitCount: 1,
      featureStationPassCount: 1,
      featureStationVisitCount: 1,
      featureHandlePassCount: 1,
      featureHandleWayVisitCount: 1,
      featurePhysicalPassCount: 0,
      featureFacilityPassCount: 0,
      featureWayLabelPassCount: 0,
      featureNamedWayVisitCount: 0,
      featureLaneGeometryBuildCount: 0,
    });
  });

  it('builds all fifteen feature collections when no partial plan is supplied', () => {
    const counts = operationCounts();

    buildFeatures(fixture(), null, ['road'], view, 'station', 'group', { counts });

    expect(counts).toMatchObject({
      featureCollectionBuildCount: 16,
      featureTopologyPassCount: 1,
      featureTopologyWayVisitCount: 1,
      featureStationPassCount: 1,
      featureHandlePassCount: 1,
      featurePhysicalPassCount: 1,
      featureFacilityPassCount: 1,
      featureWayLabelPassCount: 1,
      featureNamedWayVisitCount: 1,
    });
  });
});
