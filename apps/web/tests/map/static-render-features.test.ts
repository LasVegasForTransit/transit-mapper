import { describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import {
  buildFeatures,
  type SystemFeatures,
  type ViewOptions,
} from '@transitmapper/core/render/buildFeatures';
import { renderFeatureId, systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { createSystemRenderScene } from '@transitmapper/core/render/system-render-scene';
import { buildFeaturesForFittedMap } from '../../src/map/fitted-map-feature-builder';
import {
  projectFeaturesForFittedMap,
  renderPresentationForFittedMap,
  type FittedMapLike,
} from '../../src/map/static-render-features';
import type { FeatureProjectionWorkerClient } from '../../src/map/feature-projection-worker';
import { SYSTEM_FEATURE_SOURCE_BY_NAME } from '../../src/map/system-feature-sources';

function fittedMap(): FittedMapLike {
  return {
    getBounds: () => ({
      getSouthWest: () => ({ lng: -115.3, lat: 36.02 }),
      getNorthEast: () => ({ lng: -114.98, lat: 36.31 }),
    }),
    getZoom: () => 11.625,
    getCanvas: () => ({ clientWidth: 900, clientHeight: 600 }),
    getContainer: () => ({ clientWidth: 450, clientHeight: 300 }),
    getPixelRatio: () => 3,
  };
}

function networkView(): ViewOptions {
  return {
    viewMode: 'network',
    visibleModes: new Set(),
    visibleWayTypes: new Set(),
  };
}

describe('static map render presentation', () => {
  it('projects a fitted static view through the feature worker', async () => {
    const features = buildFeaturesForFittedMap(createEmptySystem(), networkView(), fittedMap());
    const project = vi.fn(() => Promise.resolve({ features, counts: null }));
    const worker: Pick<FeatureProjectionWorkerClient, 'project'> = { project };

    await expect(
      projectFeaturesForFittedMap({
        worker,
        system: createEmptySystem(),
        view: networkView(),
        map: fittedMap(),
      }),
    ).resolves.toBe(features);
    expect(project).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizeVisualScene: true,
      }),
      undefined,
    );
  });

  it('copies the final camera and CSS dimensions into buildFeatures', () => {
    const system = createEmptySystem();
    let receivedView: ViewOptions | undefined;

    buildFeaturesForFittedMap(system, networkView(), fittedMap(), {
      build: (nextSystem, selection, handleWayIds, view) => {
        receivedView = view;
        return buildFeatures(nextSystem, selection, handleWayIds, view);
      },
    });

    expect(receivedView?.presentation).toEqual({
      bounds: {
        southwest: [-115.3, 36.02],
        northeast: [-114.98, 36.31],
      },
      zoom: 11.625,
      viewportWidthPx: 900,
      viewportHeightPx: 600,
      displayedWidthPx: 450,
      displayedHeightPx: 300,
      pixelRatio: 3,
    });
  });

  it('allows a known final display footprint to differ from the map container', () => {
    const presentation = renderPresentationForFittedMap(fittedMap(), {
      displayedWidthPx: 360,
      displayedHeightPx: 240,
    });

    expect(presentation.displayedWidthPx).toBe(360);
    expect(presentation.displayedHeightPx).toBe(240);
    expect(presentation.viewportWidthPx).toBe(900);
    expect(presentation.viewportHeightPx).toBe(600);
  });

  it('normalizes visual source order through the same stable-ID scene as live rendering', () => {
    const system = createEmptySystem();
    const sourceId = systemFeatureSourceId('ways');
    const district = renderFeatureId(sourceId, 'district', ['corridor']);
    const overview = renderFeatureId(sourceId, 'overview', ['corridor']);
    let rawFeatures: SystemFeatures | undefined;

    const normalized = buildFeaturesForFittedMap(system, networkView(), fittedMap(), {
      build: (nextSystem, selection, handleWayIds, view) => {
        const features = buildFeatures(nextSystem, selection, handleWayIds, view);
        features.ways.features = [
          {
            type: 'Feature',
            id: district,
            properties: { id: 'corridor', renderTier: 'district' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [1, 0],
              ],
            },
          },
          {
            type: 'Feature',
            id: overview,
            properties: { id: 'corridor', renderTier: 'overview' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 1],
                [1, 1],
              ],
            },
          },
        ];
        rawFeatures = features;
        return features;
      },
    });
    if (!rawFeatures) throw new Error('static builder did not run');
    const liveScene = createSystemRenderScene({
      revision: 'live-comparison',
      features: rawFeatures,
      sourceIds: SYSTEM_FEATURE_SOURCE_BY_NAME,
    });

    expect(normalized.ways.features.map(({ id }) => id)).toEqual([overview, district]);
    expect(normalized.ways.features.map(({ id }) => id)).toEqual(
      liveScene.featuresBySource
        .get(SYSTEM_FEATURE_SOURCE_BY_NAME.ways)
        ?.features.map(({ id }) => id),
    );
  });

  it('excludes hit geometry and rejects duplicate IDs at the static boundary', () => {
    const system = createEmptySystem();
    const sourceId = systemFeatureSourceId('services');
    const duplicate = renderFeatureId(sourceId, 'line', ['duplicate']);
    const feature = {
      type: 'Feature' as const,
      id: duplicate,
      properties: { serviceId: 'service', hitTarget: true },
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [0, 0],
          [1, 0],
        ],
      },
    };

    const withoutHits = buildFeaturesForFittedMap(system, networkView(), fittedMap(), {
      build: (nextSystem, selection, handleWayIds, view) => {
        const features = buildFeatures(nextSystem, selection, handleWayIds, view);
        features.services.features = [feature];
        return features;
      },
    });
    expect(withoutHits.services.features).toEqual([]);

    expect(() =>
      buildFeaturesForFittedMap(system, networkView(), fittedMap(), {
        build: (nextSystem, selection, handleWayIds, view) => {
          const features = buildFeatures(nextSystem, selection, handleWayIds, view);
          features.services.features = [
            feature,
            { ...feature, properties: { serviceId: 'other' } },
          ];
          return features;
        },
      }),
    ).toThrow(/duplicate render feature ID/i);
  });
});
