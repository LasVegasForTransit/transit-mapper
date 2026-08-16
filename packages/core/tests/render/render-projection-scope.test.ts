import { describe, expect, it } from 'vitest';
import { buildFeatures, createFeatureBuildOperationCounts } from '../../src/render/buildFeatures';
import { namedWayLabelDependencyId } from '../../src/render/dependency-index';
import { planRenderProjectionScope } from '../../src/render/render-projection-scope';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';
import {
  DISTRICT_VIEW,
  featureProperty,
  projectionFixture,
  scopedProjection,
  SCOPED_FEATURES,
  STREET_VIEW,
} from '../support/render-projection-scope-fixture.test';

describe('render projection scope planning', () => {
  it('maps a corridor edit to exact physical, service, junction, stop, and label candidates', () => {
    const previous = projectionFixture();
    const next = {
      ...previous,
      ways: previous.ways.map((way) =>
        way.id === 'west'
          ? { ...way, points: [[-115.201, 36.141], way.points[1]] as typeof way.points }
          : way,
      ),
    };

    const scope = scopedProjection(previous, next);

    expect(scope.candidates.physicalWayIds).toEqual(['west', 'east']);
    expect(scope.candidates.serviceWayIds).toEqual(['west', 'east']);
    expect(scope.candidates.topologyWayIds).toEqual(['west', 'east']);
    expect(scope.candidates.junctionNodeIds).toEqual(['main-junction']);
    expect(scope.candidates.connectorNodeIds).toEqual(['main-junction']);
    expect(scope.candidates.geometryNodeIds).toEqual(['main-junction']);
    expect(scope.candidates.stopIds).toEqual(['main-stop']);
    expect(scope.candidates.stationIds).toEqual([]);
    expect(scope.candidates.labelDependencyIds).toEqual([
      namedWayLabelDependencyId('main-name', 'west'),
    ]);
    expect(scope.candidates.labelWayIds).toEqual(['west']);
    expect(scope.candidates.namedWayIds).toEqual(['main-name']);
    expect(scope.changedServiceIds).toEqual([]);
    expect(scope.affectedServiceIds).toEqual(['main-service']);
    expect(scope.replacement).toMatchObject({
      physicalWayIds: ['west', 'east'],
      serviceWayIds: ['west', 'east'],
      serviceIds: ['main-service'],
      junctionNodeIds: ['main-junction'],
      connectorNodeIds: ['main-junction'],
      stopIds: ['main-stop'],
      stationIds: [],
      labelDependencyIds: [namedWayLabelDependencyId('main-name', 'west')],
      labelWayIds: ['west'],
      namedWayIds: ['main-name'],
    });
  });

  it('maps a service-only edit to service ways without invalidating physical corridors', () => {
    const previous = projectionFixture();
    const next = {
      ...previous,
      services: previous.services.map((service) =>
        service.id === 'main-service' ? { ...service, color: '#336699' } : service,
      ),
    };

    const scope = scopedProjection(previous, next);

    expect(scope.candidates.physicalWayIds).toEqual([]);
    expect(scope.candidates.serviceWayIds).toEqual(['west', 'east']);
    expect(scope.candidates.topologyWayIds).toEqual(['west', 'east']);
    expect(scope.candidates.junctionNodeIds).toEqual([]);
    expect(scope.candidates.connectorNodeIds).toEqual([]);
    expect(scope.candidates.geometryNodeIds).toEqual(['main-junction']);
    expect(scope.candidates.stopIds).toEqual(['main-stop']);
    expect(scope.candidates.stationIds).toEqual([]);
    expect(scope.candidates.labelDependencyIds).toEqual([]);
    expect(scope.candidates.labelWayIds).toEqual([]);
    expect(scope.candidates.namedWayIds).toEqual([]);
    expect(scope.changedServiceIds).toEqual(['main-service']);
    expect(scope.affectedServiceIds).toEqual(['main-service']);
    expect(scope.replacement).toMatchObject({
      physicalWayIds: [],
      serviceWayIds: ['west', 'east'],
      serviceIds: ['main-service'],
      junctionNodeIds: [],
      connectorNodeIds: [],
      stopIds: ['main-stop'],
      stationIds: [],
      labelDependencyIds: [],
      labelWayIds: [],
      namedWayIds: [],
    });
  });

  it('retains prior candidates and stable domain IDs for removals', () => {
    const previous = projectionFixture();
    const next = {
      ...previous,
      ways: previous.ways.filter((way) => !['west', 'east'].includes(way.id)),
      nodes: previous.nodes.filter((node) => node.id !== 'main-junction'),
      stops: previous.stops.filter((stop) => stop.id !== 'main-stop'),
      stations: previous.stations.filter((station) => station.id !== 'main-station'),
      namedWays: previous.namedWays.filter((namedWay) => namedWay.id !== 'main-name'),
    };

    const scope = scopedProjection(previous, next);

    expect(scope.candidates.physicalWayIds).toEqual([]);
    expect(scope.candidates.serviceWayIds).toEqual([]);
    expect(scope.candidates.topologyWayIds).toEqual([]);
    expect(scope.candidates.junctionNodeIds).toEqual([]);
    expect(scope.candidates.geometryNodeIds).toEqual([]);
    expect(scope.candidates.stopIds).toEqual([]);
    expect(scope.candidates.stationIds).toEqual([]);
    expect(scope.candidates.labelWayIds).toEqual([]);
    expect(scope.candidates.namedWayIds).toEqual([]);
    expect(scope.changedServiceIds).toEqual([]);
    expect(scope.affectedServiceIds).toEqual(['main-service']);
    expect(scope.replacement).toMatchObject({
      physicalWayIds: ['west', 'east'],
      serviceWayIds: ['west', 'east'],
      serviceIds: ['main-service'],
      junctionNodeIds: ['main-junction'],
      connectorNodeIds: ['main-junction'],
      stopIds: ['main-stop'],
      stationIds: ['main-station'],
      labelWayIds: ['west', 'east'],
      namedWayIds: ['main-name'],
    });
  });

  it('falls back when the document identity, Diagram layout, or bundle allocation changes', () => {
    const previous = projectionFixture();
    const documentReplacement = { ...previous, id: 'replacement-document' };
    const serviceModeReplacement = {
      ...previous,
      services: previous.services.map((service) =>
        service.id === 'main-service' ? { ...service, modeId: 'rail' } : service,
      ),
    };
    const addedService = {
      ...previous,
      services: [
        ...previous.services,
        aService('added-service', [
          aPattern('added-pattern', [previous.ways[0]], [previous.ways[0].id]),
        ]),
      ],
    };

    expect(planRenderProjectionScope(previous, documentReplacement)).toEqual({
      kind: 'full',
      reason: 'document-change',
    });
    expect(planRenderProjectionScope(previous, previous, { viewMode: 'diagram' })).toEqual({
      kind: 'full',
      reason: 'diagram',
    });
    expect(planRenderProjectionScope(previous, serviceModeReplacement)).toEqual({
      kind: 'full',
      reason: 'service-bundle-allocation',
    });
    expect(planRenderProjectionScope(previous, addedService)).toEqual({
      kind: 'full',
      reason: 'service-bundle-allocation',
    });
  });

  it('projects only one changed corridor dependency closure from two visible corridors', () => {
    const previous = projectionFixture();
    const next = {
      ...previous,
      ways: previous.ways.map((way) =>
        way.id === 'west'
          ? { ...way, points: [[-115.201, 36.141], way.points[1]] as typeof way.points }
          : way,
      ),
    };
    const projectionScope = scopedProjection(previous, next);
    const counts = createFeatureBuildOperationCounts();

    const features = buildFeatures(
      next,
      { kind: 'node', id: 'main-junction' },
      [],
      STREET_VIEW,
      null,
      null,
      {
        requestedFeatures: SCOPED_FEATURES,
        projectionScope,
        counts,
      },
    );

    expect(counts).toMatchObject({
      featureTopologyWayVisitCount: 2,
      featureServiceWayVisitCount: 2,
      featureJunctionNodeVisitCount: 1,
      featureStopVisitCount: 1,
      // An anchored Stop shares the corridor dependency closure. The physical
      // Station is an independent footprint/platform and must not be rebuilt
      // for a corridor geometry edit.
      featurePhysicalStationVisitCount: 0,
      featureNamedWayVisitCount: 1,
    });
    expect(
      new Set(features.ways.features.map((feature) => featureProperty(feature, 'id'))),
    ).toEqual(new Set(['west', 'east']));
    expect(
      new Set(features.services.features.map((feature) => featureProperty(feature, 'wayId'))),
    ).toEqual(new Set(['west', 'east']));
    expect(features.stops.features.map((feature) => featureProperty(feature, 'id'))).toEqual([
      'main-stop',
    ]);
    expect(features.footprints.features).toEqual([]);
    expect(features.platforms.features).toEqual([]);
    expect(
      new Set(features.lanes.features.map((feature) => featureProperty(feature, 'wayId'))),
    ).toEqual(new Set(['west', 'east']));
    expect(
      features.junctions.features.map((feature) => featureProperty(feature, 'nodeId')),
    ).toEqual(['main-junction']);
    expect(features.wayLabels.features).toHaveLength(1);
    expect(features.wayLabels.features[0]?.properties).toMatchObject({
      namedWayId: 'main-name',
      wayId: 'west',
    });
  });

  it('projects service-only edits on affected ways without rebuilding physical corridors', () => {
    const previous = projectionFixture();
    const next = {
      ...previous,
      services: previous.services.map((service) =>
        service.id === 'main-service' ? { ...service, color: '#336699' } : service,
      ),
    };
    const projectionScope = scopedProjection(previous, next);
    const counts = createFeatureBuildOperationCounts();

    const features = buildFeatures(
      next,
      { kind: 'service', id: 'main-service' },
      [],
      DISTRICT_VIEW,
      null,
      null,
      { requestedFeatures: SCOPED_FEATURES, projectionScope, counts },
    );

    expect(counts).toMatchObject({
      featureTopologyWayVisitCount: 2,
      featureServiceWayVisitCount: 2,
      featureJunctionNodeVisitCount: 0,
      featurePhysicalStationVisitCount: 0,
      featureNamedWayVisitCount: 0,
    });
    expect(features.ways.features).toEqual([]);
    expect(features.lanes.features).toEqual([]);
    expect(features.laneMarkings.features).toEqual([]);
    expect(features.laneArrows.features).toEqual([]);
    expect(features.junctions.features).toEqual([]);
    expect(features.connectors.features).toEqual([]);
    expect(
      new Set(features.services.features.map((feature) => featureProperty(feature, 'wayId'))),
    ).toEqual(new Set(['west', 'east']));
    expect(features.serviceTermini.features).not.toHaveLength(0);
    expect(features.wayLabels.features).toEqual([]);
  });

  it('keeps an unrelated corridor paint fragment out of a scoped adjacent-way replacement', () => {
    const west = aRoad('west', [
      [-115.2, 36.14],
      [-115.18, 36.14],
    ]);
    const east = aRoad('east', [
      [-115.18, 36.14],
      [-115.16, 36.14],
    ]);
    const previous = aSystem({
      ways: [west, east],
      services: [
        aService('main-service', [aPattern('main-pattern', [west, east], [west.id, east.id])]),
      ],
      nodes: [],
      stations: [],
      namedWays: [],
    });
    const next = {
      ...previous,
      ways: previous.ways.map((way) =>
        way.id === 'east'
          ? { ...way, points: [way.points[0], [-115.159, 36.141]] as typeof way.points }
          : way,
      ),
    };
    const full = buildFeatures(next, null, [], DISTRICT_VIEW);
    const projectionScope = scopedProjection(previous, next);
    const partial = buildFeatures(next, null, [], DISTRICT_VIEW, null, null, {
      requestedFeatures: ['services'],
      projectionScope,
    });
    const painted = (features: typeof full) =>
      features.services.features.filter((feature) => feature.properties?.hitTarget !== true);
    const fullByWay = new Map(
      painted(full).map((feature) => [featureProperty(feature, 'wayId'), feature.id] as const),
    );

    expect(painted(partial)).toEqual(
      painted(full).filter((feature) => featureProperty(feature, 'wayId') === 'east'),
    );
    expect(painted(partial).some((feature) => feature.id === fullByWay.get('west'))).toBe(false);
  });

  it('projects termini for services affected by a corridor-only scope', () => {
    const previous = projectionFixture();
    const next = {
      ...previous,
      ways: previous.ways.map((way) =>
        way.id === 'west'
          ? { ...way, points: [[-115.201, 36.141], way.points[1]] as typeof way.points }
          : way,
      ),
    };

    const features = buildFeatures(
      next,
      { kind: 'service', id: 'main-service' },
      [],
      DISTRICT_VIEW,
      null,
      null,
      {
        requestedFeatures: ['serviceTermini'],
        projectionScope: scopedProjection(previous, next),
      },
    );

    expect(features.serviceTermini.features).not.toHaveLength(0);
  });
});
