/** Domain-scoped replacement for the synchronous compatibility scene path. */
import { featureCollectionStats } from '@transitmapper/core/render/feature-stats';
import type {
  RenderDomainIdentity,
  RenderFeatureId,
} from '@transitmapper/core/render/render-identity';
import {
  compareRenderPaintOrder,
  type RenderFeatureCollection,
} from '@transitmapper/core/render/render-scene';
import {
  EMPTY_RENDER_COLLECTION,
  type IncrementalSourceState,
  type SourceFeatureStats,
} from './scene-source-state';

export interface ScopedSourceMergeResult {
  state: IncrementalSourceState;
  replacedFeatureIds: ReadonlySet<RenderFeatureId>;
}

interface ReplacedCollection {
  collection: RenderFeatureCollection;
  removed: RenderFeatureCollection;
}

function replaceCollection(
  previous: RenderFeatureCollection,
  partial: RenderFeatureCollection,
  replacedFeatureIds: ReadonlySet<RenderFeatureId>,
): ReplacedCollection {
  const retained = [] as RenderFeatureCollection['features'];
  const removed = [] as RenderFeatureCollection['features'];
  for (const feature of previous.features) {
    (replacedFeatureIds.has(feature.id) ? removed : retained).push(feature);
  }
  if (removed.length === 0 && partial.features.length === 0) {
    return { collection: previous, removed: EMPTY_RENDER_COLLECTION };
  }
  const features = [...retained, ...partial.features].sort(compareRenderPaintOrder);
  return {
    collection: { type: 'FeatureCollection', features },
    removed: { type: 'FeatureCollection', features: removed },
  };
}

function sameFeatureIds(
  left: readonly RenderFeatureId[] | undefined,
  right: readonly RenderFeatureId[],
): boolean {
  return (
    left?.length === right.length && left.every((featureId, index) => featureId === right[index])
  );
}

function mergeDomainIndex(
  previous: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]>,
  previousDomainsByFeature: ReadonlyMap<RenderFeatureId, readonly RenderDomainIdentity[]>,
  partial: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]>,
  replacedFeatureIds: ReadonlySet<RenderFeatureId>,
): ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]> {
  const affectedDomains = new Set<RenderDomainIdentity>(partial.keys());
  for (const featureId of replacedFeatureIds) {
    for (const domain of previousDomainsByFeature.get(featureId) ?? []) affectedDomains.add(domain);
  }
  if (affectedDomains.size === 0) return previous;

  const merged = new Map(previous);
  for (const domain of affectedDomains) {
    const featureIds = [
      ...(previous.get(domain) ?? []).filter((featureId) => !replacedFeatureIds.has(featureId)),
      ...(partial.get(domain) ?? []),
    ];
    const canonical = [...new Set(featureIds)].sort();
    if (canonical.length === 0) merged.delete(domain);
    else if (!sameFeatureIds(previous.get(domain), canonical)) merged.set(domain, canonical);
  }
  return merged;
}

function mergeDomainsByFeature(
  previous: ReadonlyMap<RenderFeatureId, readonly RenderDomainIdentity[]>,
  partial: ReadonlyMap<RenderFeatureId, readonly RenderDomainIdentity[]>,
  replacedFeatureIds: ReadonlySet<RenderFeatureId>,
): ReadonlyMap<RenderFeatureId, readonly RenderDomainIdentity[]> {
  if (replacedFeatureIds.size === 0 && partial.size === 0) return previous;
  const merged = new Map(previous);
  for (const featureId of replacedFeatureIds) merged.delete(featureId);
  for (const [featureId, domains] of partial) merged.set(featureId, domains);
  return merged;
}

function collectionStats(collection: RenderFeatureCollection): {
  featureCount: number;
  vertexCount: number;
} {
  return featureCollectionStats([collection]);
}

function nextSourceStats(
  previous: SourceFeatureStats,
  removedVisual: RenderFeatureCollection,
  removedHits: RenderFeatureCollection,
  added: SourceFeatureStats,
): SourceFeatureStats {
  const visual = collectionStats(removedVisual);
  const hits = collectionStats(removedHits);
  return {
    visualFeatureCount:
      previous.visualFeatureCount - visual.featureCount + added.visualFeatureCount,
    visualVertexCount: previous.visualVertexCount - visual.vertexCount + added.visualVertexCount,
    hitFeatureCount: previous.hitFeatureCount - hits.featureCount + added.hitFeatureCount,
    hitVertexCount: previous.hitVertexCount - hits.vertexCount + added.hitVertexCount,
  };
}

function replacementFeatureIds(
  previous: IncrementalSourceState,
  replacementDomains: ReadonlySet<RenderDomainIdentity>,
): ReadonlySet<RenderFeatureId> {
  const replaced = new Set<RenderFeatureId>();
  for (const domain of replacementDomains) {
    for (const featureId of previous.domains.get(domain) ?? []) replaced.add(featureId);
  }
  return replaced;
}

function validatePartialOwnership(
  previous: IncrementalSourceState,
  partial: IncrementalSourceState,
  replacementDomains: ReadonlySet<RenderDomainIdentity>,
  replacedFeatureIds: ReadonlySet<RenderFeatureId>,
): void {
  for (const featureId of partial.featureIds) {
    const featureDomains = partial.domainsByFeature.get(featureId) ?? [];
    if (!featureDomains.some((domain) => replacementDomains.has(domain))) {
      throw new Error(
        `Scoped render feature is outside its replacement domain scope: ${featureId}`,
      );
    }
    if (previous.featureIdSet.has(featureId) && !replacedFeatureIds.has(featureId)) {
      throw new Error(
        `Scoped render feature conflicts with retained source ownership: ${featureId}`,
      );
    }
  }
}

/**
 * Replaces only features owned by the supplied domains. A feature with several
 * semantic owners is indivisible: replacing one owner replaces all bindings.
 */
export function mergeScopedSourceState(
  previous: IncrementalSourceState,
  partial: IncrementalSourceState,
  replacementDomains: readonly RenderDomainIdentity[],
): ScopedSourceMergeResult {
  const replacementDomainSet = new Set(replacementDomains);
  const replacedFeatureIds = replacementFeatureIds(previous, replacementDomainSet);
  validatePartialOwnership(previous, partial, replacementDomainSet, replacedFeatureIds);
  if (replacedFeatureIds.size === 0 && partial.featureIds.length === 0) {
    return { state: previous, replacedFeatureIds };
  }

  const visual = replaceCollection(previous.visual, partial.visual, replacedFeatureIds);
  const hits = replaceCollection(previous.hits, partial.hits, replacedFeatureIds);
  const featureIds = [
    ...visual.collection.features.map((feature) => feature.id),
    ...hits.collection.features.map((feature) => feature.id),
  ];
  return {
    state: {
      sourceId: previous.sourceId,
      visual: visual.collection,
      hits: hits.collection,
      domains: mergeDomainIndex(
        previous.domains,
        previous.domainsByFeature,
        partial.domains,
        replacedFeatureIds,
      ),
      visualDomains: mergeDomainIndex(
        previous.visualDomains,
        previous.domainsByFeature,
        partial.visualDomains,
        replacedFeatureIds,
      ),
      domainsByFeature: mergeDomainsByFeature(
        previous.domainsByFeature,
        partial.domainsByFeature,
        replacedFeatureIds,
      ),
      featureIds,
      featureIdSet: new Set(featureIds),
      featuresById: new Map(
        [...visual.collection.features, ...hits.collection.features].map((feature) => [
          feature.id,
          feature,
        ]),
      ),
      visualFeatureIdSet: new Set(visual.collection.features.map((feature) => feature.id)),
      hitFeatureIdSet: new Set(hits.collection.features.map((feature) => feature.id)),
      stats: nextSourceStats(previous.stats, visual.removed, hits.removed, partial.stats),
    },
    replacedFeatureIds,
  };
}
