import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { wholeLeg } from '@transitmapper/core/model/geo';
import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  createFeatureBuildOperationCounts,
  type ViewOptions,
} from '@transitmapper/core/render/buildFeatures';
import {
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_SERVICE_TERMINI,
  SRC_STATIONS,
} from '../../src/map/layers';
import { buildFeaturesForSources } from '../../src/map/sourceFeatureProjection';
import { ALL_SYSTEM_FEATURE_SOURCES } from '../../src/map/sourceUploadPlan';

const diagramView: ViewOptions = {
  viewMode: 'diagram',
  visibleModes: new Set(['bus']),
  visibleWayTypes: new Set(['road']),
};

const networkView: ViewOptions = {
  ...diagramView,
  viewMode: 'network',
};

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
    facilities: [
      {
        id: 'entrance',
        typeId: 'entrance',
        geometry: [-115.16, 36.116],
      },
    ],
  };
}

function operationCounts() {
  return {
    ...createFeatureBuildOperationCounts(),
    diagramTopologyBuildCount: 0,
    diagramTopologyCacheHitCount: 0,
    diagramStationBuildCount: 0,
    diagramStationCacheHitCount: 0,
  };
}

describe('MapLibre source feature projection', () => {
  it('does not compute schematic topology for Diagram sources that are always hidden', () => {
    const counts = operationCounts();

    const features = buildFeaturesForSources({
      system: fixture(),
      selection: null,
      handleWayIds: [],
      view: diagramView,
      sourceIds: [SRC_FACILITIES],
      counts,
    });

    expect(features.facilities.features).toEqual([]);
    expect(counts).toMatchObject({
      featureCollectionBuildCount: 1,
      featureFacilityPassCount: 1,
      diagramTopologyBuildCount: 0,
      diagramTopologyCacheHitCount: 0,
      diagramStationBuildCount: 0,
      diagramStationCacheHitCount: 0,
    });
  });

  it('does not project editable service termini into Diagram', () => {
    const counts = operationCounts();
    const system = fixture();
    system.services = [
      {
        id: 'line',
        name: 'Line',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [
          {
            id: 'pattern',
            sections: [{ kind: 'shared', legs: [wholeLeg('way')] }],
          },
        ],
      },
    ];

    const features = buildFeaturesForSources({
      system,
      selection: { kind: 'service', id: 'line' },
      handleWayIds: [],
      view: diagramView,
      sourceIds: [SRC_SERVICE_TERMINI],
      counts,
    });

    expect(features.serviceTermini.features).toEqual([]);
    expect(counts.diagramTopologyBuildCount).toBe(0);
  });

  it('reuses Diagram topology while remapping a changed station collection', () => {
    const system = fixture();
    const warmCounts = operationCounts();
    buildFeaturesForSources({
      system,
      selection: null,
      handleWayIds: [],
      view: diagramView,
      sourceIds: ALL_SYSTEM_FEATURE_SOURCES,
      counts: warmCounts,
    });
    const counts = operationCounts();
    const changed = {
      ...system,
      stations: system.stations.map((station) => ({ ...station, name: 'Renamed' })),
    };

    const features = buildFeaturesForSources({
      system: changed,
      selection: null,
      handleWayIds: [],
      view: diagramView,
      sourceIds: [SRC_STATIONS, SRC_FOOTPRINTS, SRC_PLATFORMS, SRC_PHYSICAL_HANDLES],
      counts,
    });

    expect(features.stations.features[0]?.properties?.name).toBe('Renamed');
    expect(counts).toMatchObject({
      featureCollectionBuildCount: 4,
      featureTopologyPassCount: 0,
      featureStationPassCount: 1,
      diagramTopologyBuildCount: 0,
      diagramTopologyCacheHitCount: 1,
      diagramStationBuildCount: 1,
      diagramStationCacheHitCount: 0,
    });
  });

  it('forwards a targeted station projection without changing its settled feature', () => {
    const system = fixture();
    system.stations.push({
      id: 'other-station',
      coord: [-114.9, 36.3],
      anchors: [],
    });
    const full = buildFeaturesForSources({
      system,
      selection: null,
      handleWayIds: [],
      view: networkView,
      sourceIds: [SRC_STATIONS],
    });

    const targeted = buildFeaturesForSources({
      system,
      selection: null,
      handleWayIds: [],
      view: networkView,
      sourceIds: [SRC_STATIONS],
      stationIds: ['station'],
    });

    expect(targeted.stations.features).toEqual([
      full.stations.features.find((feature) => feature.properties?.id === 'station'),
    ]);
  });

  it('builds every collection for initial, view, and repaired-style source plans', () => {
    const counts = operationCounts();

    buildFeaturesForSources({
      system: fixture(),
      selection: null,
      handleWayIds: [],
      view: diagramView,
      sourceIds: ALL_SYSTEM_FEATURE_SOURCES,
      counts,
    });

    expect(counts.featureCollectionBuildCount).toBe(16);
    expect(counts.featureTopologyPassCount).toBe(1);
    expect(counts.featureStationPassCount).toBe(1);
    expect(counts.featureHandlePassCount).toBe(1);
    expect(counts.featurePhysicalPassCount).toBe(1);
    expect(counts.featureFacilityPassCount).toBe(1);
    expect(counts.featureWayLabelPassCount).toBe(1);
    expect(counts.diagramTopologyBuildCount + counts.diagramTopologyCacheHitCount).toBe(1);
  });
});
