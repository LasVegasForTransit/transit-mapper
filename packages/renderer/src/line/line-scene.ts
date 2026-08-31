import type { FeatureCollection, LineString } from 'geojson';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { NetworkQuery } from '@transitmapper/core/network/query';
import { createSchemaV16SystemProvider } from '@transitmapper/core/network/schema-v16-system-provider';
import type { MapPresentation } from '@transitmapper/core/presentation/map-presentation';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
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

export interface ProjectSchemaV16LineSceneOptions {
  readonly system: TransitSystem;
  readonly view: RenderViewOptions;
  readonly sceneRevision: string;
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

function boundsFor(view: RenderViewOptions): NetworkQuery['bounds'] {
  const { southwest, northeast } = view.presentation.bounds;
  return {
    kind: southwest[0] <= northeast[0] ? 'ordinary' : 'crosses-antimeridian',
    west: southwest[0],
    south: southwest[1],
    east: northeast[0],
    north: northeast[1],
  };
}

function centerLongitude(bounds: NetworkQuery['bounds']): number {
  if (bounds.kind === 'ordinary') return (bounds.west + bounds.east) / 2;
  const midpoint = (bounds.west + bounds.east + 360) / 2;
  return midpoint > 180 ? midpoint - 360 : midpoint;
}

function presentationFor(view: RenderViewOptions, bounds: NetworkQuery['bounds']): MapPresentation {
  return {
    camera: {
      center: [centerLongitude(bounds), (bounds.south + bounds.north) / 2],
      zoom: view.presentation.zoom,
      bearing: 0,
      pitch: 0,
    },
    representationId: view.viewMode,
  };
}

function queryFor(view: RenderViewOptions): NetworkQuery {
  return {
    serviceTime: { kind: 'live' },
    modes: { kind: 'only', ids: [...view.visibleModes].sort() },
    filters: {},
    bounds: boundsFor(view),
    detailBand: 'district',
  };
}

async function resolveSchemaV16LineScene(
  system: TransitSystem,
  query: NetworkQuery,
  presentation: MapPresentation,
  sceneRevision: string,
): Promise<ResolvedLineScene> {
  const provider = createSchemaV16SystemProvider(system);
  const descriptor = await provider.describe({
    kind: 'transit-system',
    id: system.id,
    revision: { kind: 'latest' },
  });
  const result = await provider.resolve(descriptor.content, query);
  return projectResolvedLineScene({
    result,
    presentation,
    sceneRevision,
    sourceId: SERVICE_SOURCE_ID,
  });
}

/** Network and Diagram present passenger Lines. Infrastructure continues to
 * render physical and per-Service geometry through the existing projector. */
export function usesPassengerLineScene(viewMode: RenderViewOptions['viewMode']): boolean {
  return viewMode === 'network' || viewMode === 'diagram';
}

/** Temporary schema-v16 host bridge. It derives the network query from the
 * current camera and filters, while the pure Line scene remains provider-free. */
export async function projectSchemaV16LineScene(
  options: ProjectSchemaV16LineSceneOptions,
): Promise<ResolvedLineScene> {
  const query = queryFor(options.view);
  return resolveSchemaV16LineScene(
    options.system,
    query,
    presentationFor(options.view, query.bounds),
    options.sceneRevision,
  );
}

async function createCache(system: TransitSystem): Promise<LineSceneCache> {
  const resolved = await resolveSchemaV16LineScene(
    system,
    WORLD_QUERY,
    {
      camera: { center: system.viewport.center, zoom: system.viewport.zoom, bearing: 0, pitch: 0 },
      representationId: 'network',
    },
    `line:${cacheKey(system)}`,
  );
  return { key: cacheKey(system), resolved };
}

export function lineSceneFeatures(scene: ResolvedLineScene): FeatureCollection<LineString> {
  const features = scene.scene.featuresBySource.get(SERVICE_SOURCE_ID);
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
  return { cache: retained, features: lineSceneFeatures(retained.resolved) };
}
