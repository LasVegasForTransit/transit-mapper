import type { Feature, FeatureCollection, Point } from 'geojson';
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
import type {
  GeoJsonSourceTarget,
  GeoJsonSourceUpdate,
} from '../../src/sources/render-scene-source-updater';

export type SourceCall =
  | { method: 'setData'; data: FeatureCollection }
  | { method: 'updateData'; data: GeoJsonSourceUpdate };

export class RecordingRenderSource implements GeoJsonSourceTarget {
  readonly calls: SourceCall[] = [];
  failNextSet = false;
  failNextUpdate = false;

  setData(data: FeatureCollection): void {
    this.calls.push({ method: 'setData', data });
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error('MapLibre rejected the full source');
    }
  }

  updateData(data: GeoJsonSourceUpdate): void {
    this.calls.push({ method: 'updateData', data });
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('MapLibre rejected the patch');
    }
  }
}

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

export interface RenderSourceFixture {
  sources: Map<SystemFeatureSourceId, RecordingRenderSource>;
  source: (sourceId: SystemFeatureSourceId) => RecordingRenderSource;
}

export function renderSourceFixture(
  sourceIds: readonly SystemFeatureSourceId[],
): RenderSourceFixture {
  const sources = new Map(sourceIds.map((sourceId) => [sourceId, new RecordingRenderSource()]));
  return {
    sources,
    source: (sourceId) => {
      const source = sources.get(sourceId);
      if (!source) throw new Error(`Missing test source: ${sourceId}`);
      return source;
    },
  };
}
