import type { Feature, FeatureCollection, Geometry } from 'geojson';
import {
  emptyRenderIdentityIndex,
  type RenderFeatureId,
  type RenderIdentityIndex,
  type SystemFeatureSourceId,
} from './render-identity';

declare const renderSceneRevisionBrand: unique symbol;

export type RenderSceneRevision = string & {
  readonly [renderSceneRevisionBrand]: 'RenderSceneRevision';
};

export interface RenderFeature<G extends Geometry | null = Geometry> extends Feature<G> {
  id: RenderFeatureId;
}

export interface RenderFeatureCollection<
  G extends Geometry | null = Geometry,
> extends FeatureCollection<G> {
  features: RenderFeature<G>[];
}

/** Per-scene projection facts. Upload facts remain adapter-owned because a
 * single scene can be consumed by live MapLibre, SVG, PNG, and previews. */
export interface RenderSceneStats {
  projectionDurationMs: number;
  candidateFeatureCount: number;
  visibleFeatureCount: number;
  generatedVisualFeatureCount: number;
  generatedHitFeatureCount: number;
  generatedVertexCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  tierTransitionCount: number;
}

export interface RenderScene {
  revision: RenderSceneRevision;
  featuresBySource: ReadonlyMap<SystemFeatureSourceId, RenderFeatureCollection>;
  hitFeatures: RenderFeatureCollection;
  identityIndex: RenderIdentityIndex;
  stats: RenderSceneStats;
}

export interface CreateRenderSceneInput {
  revision: RenderSceneRevision;
  featuresBySource: ReadonlyMap<SystemFeatureSourceId, FeatureCollection>;
  hitFeatures: FeatureCollection;
  identityIndex?: RenderIdentityIndex;
  stats: RenderSceneStats;
}

export function renderSceneRevision(value: string): RenderSceneRevision {
  if (value.length === 0 || value.trim().length === 0) {
    throw new Error('Render scene revision must not be empty.');
  }
  return value as RenderSceneRevision;
}

export function emptyRenderSceneStats(): RenderSceneStats {
  return {
    projectionDurationMs: 0,
    candidateFeatureCount: 0,
    visibleFeatureCount: 0,
    generatedVisualFeatureCount: 0,
    generatedHitFeatureCount: 0,
    generatedVertexCount: 0,
    cacheHitCount: 0,
    cacheMissCount: 0,
    tierTransitionCount: 0,
  };
}

function normalizeCollection(
  collection: FeatureCollection,
  label: string,
  allFeatureIds: Set<RenderFeatureId>,
): RenderFeatureCollection {
  const featureIds = new Set<RenderFeatureId>();
  const features: RenderFeature[] = [];

  for (const feature of collection.features) {
    if (typeof feature.id !== 'string' || feature.id.trim().length === 0) {
      throw new Error(`Every feature requires a stable top-level string ID in ${label}.`);
    }
    const id = feature.id as RenderFeatureId;
    if (featureIds.has(id)) throw new Error(`Duplicate render feature ID in ${label}: ${id}`);
    if (allFeatureIds.has(id)) throw new Error(`Duplicate render feature ID across scene: ${id}`);
    featureIds.add(id);
    allFeatureIds.add(id);
    features.push(feature as RenderFeature);
  }

  features.sort(compareRenderPaintOrder);
  return { ...collection, features };
}

function renderTierOrder(feature: RenderFeature): number {
  const renderTier: unknown = feature.properties?.renderTier;
  if (renderTier === 'overview') return 1;
  if (renderTier === 'district') return 2;
  if (renderTier === 'street') return 3;
  return 0;
}

/** Canonical order is also paint order. Stable-ID sorting alone can place a
 * Street feature below its District predecessor, reversing source-over LOD
 * composition even though both scenes contain the same data. Tier order is
 * therefore semantic; IDs remain the deterministic tie-break within a tier. */
export function compareRenderPaintOrder(left: RenderFeature, right: RenderFeature): number {
  const tierDifference = renderTierOrder(left) - renderTierOrder(right);
  return tierDifference || left.id.localeCompare(right.id);
}

/** Validates and canonicalizes a resolved scene before any renderer consumes it.
 *
 * Sorting sources and semantic paint order makes patches, exports,
 * screenshots, and repeat runs independent of projection traversal order.
 * Hit geometry remains a separate collection so visual batching never erases
 * domain interaction identity. */
export function createRenderScene(input: CreateRenderSceneInput): RenderScene {
  renderSceneRevision(input.revision);
  const allFeatureIds = new Set<RenderFeatureId>();
  const featuresBySource = new Map<SystemFeatureSourceId, RenderFeatureCollection>();
  const sources = [...input.featuresBySource.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [sourceId, collection] of sources) {
    featuresBySource.set(
      sourceId,
      normalizeCollection(collection, `source ${sourceId}`, allFeatureIds),
    );
  }

  const hitFeatures = normalizeCollection(input.hitFeatures, 'hit features', allFeatureIds);
  const identityIndex = input.identityIndex ?? emptyRenderIdentityIndex();
  for (const renderFeatureIds of identityIndex.renderFeatureIdsByDomain.values()) {
    for (const renderFeatureId of renderFeatureIds) {
      if (!allFeatureIds.has(renderFeatureId)) {
        throw new Error(
          `Render identity index references a feature absent from the scene: ${renderFeatureId}`,
        );
      }
    }
  }

  return {
    revision: input.revision,
    featuresBySource,
    hitFeatures,
    identityIndex,
    stats: input.stats,
  };
}
