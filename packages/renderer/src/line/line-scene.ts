import type { FeatureCollection, LineString } from 'geojson';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { createSchemaV16SystemProvider } from '@transitmapper/core/network/schema-v16-system-provider';
import { systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { SRC_SERVICES } from '../layers/constants';
import { projectResolvedLineScene, type ResolvedLineScene } from './resolved-line-scene';

export interface LineSceneCache {
  readonly key: string;
  readonly resolved: ResolvedLineScene;
}

export interface ProjectLineSceneOptions {
  readonly system: TransitSystem;
  readonly cache?: LineSceneCache;
}

export interface ProjectLineSceneResult {
  readonly cache: LineSceneCache;
  readonly features: FeatureCollection<LineString>;
}

const WORLD_QUERY = {
  serviceTime: { kind: 'live' as const },
  modes: { kind: 'all' as const },
  filters: {},
  bounds: { kind: 'ordinary' as const, west: -180, south: -90, east: 180, north: 90 },
  detailBand: 'district' as const,
};
const SERVICE_SOURCE_ID = systemFeatureSourceId(SRC_SERVICES);

function cacheKey(system: TransitSystem): string {
  return `${system.id}\u001f${system.updatedAt}`;
}

async function createCache(system: TransitSystem): Promise<LineSceneCache> {
  const provider = createSchemaV16SystemProvider(system);
  const descriptor = await provider.describe({
    kind: 'transit-system',
    id: system.id,
    revision: { kind: 'latest' },
  });
  const result = await provider.resolve(descriptor.content, WORLD_QUERY);
  const resolved = await projectResolvedLineScene({
    result,
    presentation: {
      camera: { center: system.viewport.center, zoom: system.viewport.zoom, bearing: 0, pitch: 0 },
      representationId: 'network',
    },
    sceneRevision: `line:${cacheKey(system)}`,
    sourceId: SERVICE_SOURCE_ID,
  });
  return { key: cacheKey(system), resolved };
}

function serviceFeatures(cache: LineSceneCache): FeatureCollection<LineString> {
  const features = cache.resolved.scene.featuresBySource.get(SERVICE_SOURCE_ID);
  if (!features) throw new Error('Resolved Line scene is missing the services source.');
  return features as FeatureCollection<LineString>;
}

/** Compatibility wrapper for the schema-v16 document worker. New hosts supply
 * already-resolved content to projectResolvedLineScene instead of fetching it here. */
export async function projectLineScene({
  system,
  cache,
}: ProjectLineSceneOptions): Promise<ProjectLineSceneResult> {
  const retained = cache?.key === cacheKey(system) ? cache : await createCache(system);
  return { cache: retained, features: serviceFeatures(retained) };
}
