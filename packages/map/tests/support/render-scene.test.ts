import type { Feature, Point } from 'geojson';
import type {
  RenderFeatureId,
  SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import {
  createRenderScene,
  emptyRenderSceneStats,
  renderSceneRevision,
  type RenderFeature,
  type RenderScene,
} from '@transitmapper/core/render/render-scene';

// The renderer's own suite has an identical pair in
// tests/support/render-scene-source-updater.test.ts. Sharing one copy would
// mean importing across a package boundary that only production code crosses.

export function renderPointFeature(id: RenderFeatureId, x: number): RenderFeature<Point> {
  return {
    type: 'Feature',
    id,
    properties: {},
    geometry: { type: 'Point', coordinates: [x, 0] },
  };
}

export interface RenderSceneSource {
  sourceId: SystemFeatureSourceId;
  features: Feature[];
}

export function renderScene(
  revision: string,
  sources: readonly RenderSceneSource[],
  hitFeatures: Feature[] = [],
): RenderScene {
  const stats = emptyRenderSceneStats();
  stats.generatedVisualFeatureCount = sources.reduce(
    (count, source) => count + source.features.length,
    0,
  );
  stats.generatedHitFeatureCount = hitFeatures.length;
  return createRenderScene({
    revision: renderSceneRevision(revision),
    featuresBySource: new Map(
      sources.map(({ sourceId, features }) => [
        sourceId,
        { type: 'FeatureCollection' as const, features },
      ]),
    ),
    hitFeatures: { type: 'FeatureCollection', features: hitFeatures },
    stats,
  });
}
