import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { wholeLeg } from '@transitmapper/core/model/geo';
import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  createFeatureBuildOperationCounts,
  type RenderViewOptions,
} from '@transitmapper/core/render/buildFeatures';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { planRenderProjectionScope } from '@transitmapper/core/render/render-projection-scope';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import {
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_SERVICE_TERMINI,
  SRC_SERVICES,
  SRC_STATIONS,
} from '../src/layers/constants';
import { buildFeaturesForSources } from '../src/projection/source-feature-projection';
import { ALL_SYSTEM_FEATURE_SOURCES } from '../src/sources/source-upload-plan';

const presentation = renderPresentationForViewport({
  center: [-115.16, 36.14],
  zoom: 8,
  width: 1_440,
  height: 900,
});

const diagramView: RenderViewOptions = {
  viewMode: 'diagram',
  visibleModes: new Set(['bus']),
  visibleWayTypes: new Set(['road']),
  presentation,
};

const networkView: RenderViewOptions = {
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
    stops: [
      {
        id: 'stop',
        coord: [-115.16, 36.115],
        anchors: [{ wayId: 'way', t: 0.5 }],
      },
    ],
    stations: [
      {
        id: 'station',
        coord: [-115.16, 36.115],
        footprint: [
          [-115.161, 36.114],
          [-115.159, 36.114],
          [-115.159, 36.116],
          [-115.161, 36.116],
        ],
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
    diagramStopBuildCount: 0,
    diagramStopCacheHitCount: 0,
    rendererCandidateFeatureCount: 0,
    rendererGeneratedFeatureCount: 0,
    rendererGeneratedVertexCount: 0,
  };
}

describe('MapLibre source feature projection', () => {
  it('records source-scoped candidates and output dimensions inside projection', () => {
    const counts = operationCounts();
    const system = fixture();
    system.services = [
      {
        id: 'line',
        name: 'Line',
        modeId: 'bus',
        path: { id: 'line', sections: [{ kind: 'shared', legs: [wholeLeg('way')] }] },
      },
    ];
    system.lines = [{ id: 'line', name: 'Line', color: '#e4572e', serviceIds: ['line'] }];

    buildFeaturesForSources({
      system,
      selection: null,
      handleWayIds: [],
      view: networkView,
      sourceIds: [SRC_STATIONS],
      counts,
    });

    expect(counts).toMatchObject({
      rendererCandidateFeatureCount: 1,
      rendererGeneratedFeatureCount: 1,
      rendererGeneratedVertexCount: 1,
    });
  });

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
      diagramStopBuildCount: 0,
      diagramStopCacheHitCount: 0,
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

        path: {
          id: 'pattern',
          sections: [{ kind: 'shared', legs: [wholeLeg('way')] }],
        },
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

  it('reuses Diagram topology while remapping a changed stop collection', () => {
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
      stops: system.stops.map((stop) => ({ ...stop, name: 'Renamed' })),
    };

    const features = buildFeaturesForSources({
      system: changed,
      selection: null,
      handleWayIds: [],
      view: diagramView,
      sourceIds: [SRC_STATIONS, SRC_FOOTPRINTS, SRC_PLATFORMS, SRC_PHYSICAL_HANDLES],
      counts,
    });

    expect(features.stops.features[0]?.properties?.name).toBe('Renamed');
    expect(counts).toMatchObject({
      featureCollectionBuildCount: 4,
      featureTopologyPassCount: 0,
      featureStopPassCount: 1,
      diagramTopologyBuildCount: 0,
      diagramTopologyCacheHitCount: 1,
      diagramStopBuildCount: 1,
      diagramStopCacheHitCount: 0,
    });
  });

  it('forwards a targeted stop projection without changing its settled feature', () => {
    const system = fixture();
    system.stops.push({
      id: 'other-stop',
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
      stopIds: ['stop'],
    });

    expect(targeted.stops.features).toEqual([
      full.stops.features.find((feature) => feature.properties?.id === 'stop'),
    ]);
  });

  it('builds physical edit handles for a selected Station rather than a Stop', () => {
    const features = buildFeaturesForSources({
      system: fixture(),
      selection: { kind: 'station', id: 'station' },
      handleWayIds: [],
      view: { ...networkView, viewMode: 'infrastructure' },
      sourceIds: [SRC_PHYSICAL_HANDLES],
      physicalHandleStationId: 'station',
    });

    expect(features.physicalHandles.features).toHaveLength(4);
    expect(features.physicalHandles.features[0]?.properties).toMatchObject({
      kind: 'footprint',
      stationId: 'station',
    });
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
    expect(counts.featureStopPassCount).toBe(1);
    expect(counts.featureHandlePassCount).toBe(1);
    expect(counts.featurePhysicalPassCount).toBe(1);
    expect(counts.featureFacilityPassCount).toBe(1);
    expect(counts.featureWayLabelPassCount).toBe(1);
    expect(counts.diagramTopologyBuildCount + counts.diagramTopologyCacheHitCount).toBe(1);
  });

  it('forwards an entity scope without counting unrelated service corridors', () => {
    const west = aRoad('west', [
      [-115.2, 36.14],
      [-115.18, 36.14],
    ]);
    const east = aRoad('east', [
      [-115.18, 36.14],
      [-115.16, 36.14],
    ]);
    const unrelated = aRoad('unrelated', [
      [-115.2, 36.18],
      [-115.16, 36.18],
    ]);
    const previous = aSystem({
      ways: [west, east, unrelated],
      services: [
        aService('main', [aPattern('main-pattern', [west, east], [west.id, east.id])]),
        aService('unrelated', [aPattern('unrelated-pattern', [unrelated], [unrelated.id])]),
      ],
      nodes: [
        {
          id: 'junction',
          coord: west.points[1],
          refs: [
            { wayId: west.id, pointIndex: 1 },
            { wayId: east.id, pointIndex: 0 },
          ],
        },
      ],
    });
    const next = {
      ...previous,
      ways: previous.ways.map((way) =>
        way.id === west.id
          ? { ...way, points: [[-115.201, 36.141], way.points[1]] as typeof way.points }
          : way,
      ),
    };
    const projection = planRenderProjectionScope(previous, next);
    expect(projection.kind).toBe('scoped');
    if (projection.kind !== 'scoped') throw new Error('expected scoped projection');
    const counts = operationCounts();

    buildFeaturesForSources({
      system: next,
      selection: null,
      handleWayIds: [],
      view: networkView,
      sourceIds: [SRC_SERVICES],
      projectionScope: projection.scope,
      counts,
    });

    expect(counts).toMatchObject({
      featureTopologyWayVisitCount: 2,
      featureServiceWayVisitCount: 2,
      rendererCandidateFeatureCount: 4,
    });
  });
});
