import { describe, expect, it } from 'vitest';
import {
  buildFeatures,
  createFeatureBuildOperationCounts,
  type RenderViewOptions,
  type SystemFeatureName,
} from '../../src/render/buildFeatures';
import {
  renderDependencyIndexFor,
  resetDependencyIndexCacheDiagnostics,
  snapshotDependencyIndexCacheDiagnostics,
} from '../../src/render/dependency-index';
import {
  resetRenderDomainIndexCacheDiagnostics,
  snapshotRenderDomainIndexCacheDiagnostics,
} from '../../src/render/render-domain-indexes';
import {
  resetViewportIndexCacheDiagnostics,
  snapshotViewportIndexCacheDiagnostics,
} from '../../src/render/viewport-index';
import {
  projectionFixture,
  scopedProjection,
  STREET_VIEW,
} from '../support/render-projection-scope-fixture.test';

const DIAGNOSTIC_FEATURES: readonly SystemFeatureName[] = [
  'ways',
  'stops',
  'footprints',
  'platforms',
  'lanes',
  'laneMarkings',
  'laneArrows',
  'junctions',
  'connectors',
  'wayLabels',
];

function resetIndexDiagnostics(): void {
  resetDependencyIndexCacheDiagnostics();
  resetViewportIndexCacheDiagnostics();
  resetRenderDomainIndexCacheDiagnostics();
}

function shiftedStreetView(longitudeOffset: number, zoomOffset: number): RenderViewOptions {
  const presentation = STREET_VIEW.presentation;
  return {
    ...STREET_VIEW,
    presentation: {
      ...presentation,
      zoom: presentation.zoom + zoomOffset,
      bounds: {
        southwest: [presentation.bounds.southwest[0] + longitudeOffset, 36.1],
        northeast: [presentation.bounds.northeast[0] + longitudeOffset, 36.22],
      },
    },
  };
}

describe('renderer cache diagnostics', () => {
  it('reports no index rebuilds while immutable collections pan and zoom', () => {
    const system = projectionFixture();
    const warmOptions = { requestedFeatures: DIAGNOSTIC_FEATURES } as const;
    renderDependencyIndexFor(system);
    buildFeatures(system, null, [], STREET_VIEW, null, null, warmOptions);
    resetIndexDiagnostics();
    const counts = createFeatureBuildOperationCounts();

    for (const view of [shiftedStreetView(0.005, 0.2), shiftedStreetView(-0.005, 0.4)]) {
      renderDependencyIndexFor(system);
      buildFeatures(system, null, [], view, null, null, {
        requestedFeatures: DIAGNOSTIC_FEATURES,
        counts,
      });
    }

    expect(snapshotDependencyIndexCacheDiagnostics()).toEqual({
      buildCount: 0,
      cacheHitCount: 2,
    });
    expect(snapshotViewportIndexCacheDiagnostics()).toEqual({
      buildCount: 0,
      cacheHitCount: 2,
    });
    expect(snapshotRenderDomainIndexCacheDiagnostics()).toEqual({
      nodes: { buildCount: 0, cacheHitCount: 2 },
      stops: { buildCount: 0, cacheHitCount: 2 },
      stations: { buildCount: 0, cacheHitCount: 2 },
      namedWays: { buildCount: 0, cacheHitCount: 2 },
      facilities: { buildCount: 0, cacheHitCount: 0 },
      groups: { buildCount: 0, cacheHitCount: 2 },
      services: { buildCount: 0, cacheHitCount: 0 },
    });
    expect(counts).toMatchObject({
      // The spatial/domain indexes stay warm. Lane geometry legitimately
      // re-resolves when camera scale changes because its curve tolerance is
      // expressed in displayed pixels.
      featureLaneGeometryBuildCount: 6,
      featureLaneGeometryCacheHitCount: 0,
    });
  });

  it('rebuilds one snapshot index and only the edited dependency closure', () => {
    const previous = projectionFixture();
    renderDependencyIndexFor(previous);
    buildFeatures(previous, null, [], STREET_VIEW, null, null, {
      requestedFeatures: DIAGNOSTIC_FEATURES,
    });
    const next = {
      ...previous,
      ways: previous.ways.map((way) =>
        way.id === 'west'
          ? { ...way, points: [[-115.201, 36.14], way.points[1]] as typeof way.points }
          : way,
      ),
    };
    resetIndexDiagnostics();

    const projectionScope = scopedProjection(previous, next);
    const counts = createFeatureBuildOperationCounts();
    const features = buildFeatures(next, null, [], STREET_VIEW, null, null, {
      requestedFeatures: DIAGNOSTIC_FEATURES,
      projectionScope,
      counts,
    });

    expect(projectionScope.candidates.physicalWayIds).toEqual(['west', 'east']);
    expect(projectionScope.candidates.physicalWayIds).not.toContain('unrelated');
    expect(counts).toMatchObject({
      featureTopologyWayVisitCount: 2,
      featureLaneGeometryBuildCount: 1,
      featureLaneGeometryCacheHitCount: 1,
      featureJunctionNodeVisitCount: 1,
      featureStopVisitCount: 1,
      featurePhysicalStationVisitCount: 0,
      featureNamedWayVisitCount: 1,
    });
    const renderedWayIds = features.lanes.features.flatMap((feature) => {
      const wayId: unknown = feature.properties?.wayId;
      return typeof wayId === 'string' ? [wayId] : [];
    });
    expect(new Set(renderedWayIds)).toEqual(new Set(['west', 'east']));
    expect(snapshotDependencyIndexCacheDiagnostics()).toEqual({
      buildCount: 1,
      cacheHitCount: 1,
    });
    expect(snapshotViewportIndexCacheDiagnostics()).toEqual({
      buildCount: 1,
      cacheHitCount: 0,
    });
    expect(snapshotRenderDomainIndexCacheDiagnostics()).toEqual({
      nodes: { buildCount: 0, cacheHitCount: 1 },
      stops: { buildCount: 0, cacheHitCount: 1 },
      stations: { buildCount: 0, cacheHitCount: 1 },
      namedWays: { buildCount: 0, cacheHitCount: 1 },
      facilities: { buildCount: 0, cacheHitCount: 0 },
      groups: { buildCount: 0, cacheHitCount: 1 },
      services: { buildCount: 0, cacheHitCount: 0 },
    });
  });
});
