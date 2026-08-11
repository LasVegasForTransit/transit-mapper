import {
  compareRenderPaintOrder,
  type RenderFeature,
  type RenderSceneRevision,
} from '@transitmapper/core/render/render-scene';
import type {
  RenderFeatureId,
  SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import type {
  RenderFeaturePatch,
  RenderScenePatch,
} from '@transitmapper/core/render/render-scene-diff';

interface MutableFeaturePatch {
  readonly add: Map<RenderFeatureId, RenderFeature>;
  readonly remove: Set<RenderFeatureId>;
}

function mutableFeaturePatch(): MutableFeaturePatch {
  return { add: new Map(), remove: new Set() };
}

function applyFeaturePatch(target: MutableFeaturePatch, patch: RenderFeaturePatch): void {
  for (const featureId of patch.remove) {
    target.add.delete(featureId);
    target.remove.add(featureId);
  }
  for (const feature of patch.add) {
    target.remove.delete(feature.id);
    target.add.set(feature.id, feature);
  }
}

function finishFeaturePatch(patch: MutableFeaturePatch): RenderFeaturePatch {
  return {
    add: [...patch.add.values()].sort(compareRenderPaintOrder),
    remove: [...patch.remove].sort(),
  };
}

function patchStats(
  add: ReadonlyMap<SystemFeatureSourceId, readonly RenderFeature[]>,
  remove: ReadonlyMap<SystemFeatureSourceId, readonly RenderFeatureId[]>,
  hits: RenderFeaturePatch,
) {
  const addedFeatureCount =
    [...add.values()].reduce((count, features) => count + features.length, 0) + hits.add.length;
  const removedFeatureCount =
    [...remove.values()].reduce((count, featureIds) => count + featureIds.length, 0) +
    hits.remove.length;
  return { addedFeatureCount, changedFeatureCount: 0, removedFeatureCount };
}

export function composeRenderScenePatches(
  revision: RenderSceneRevision,
  patches: readonly RenderScenePatch[],
): RenderScenePatch {
  const sources = new Map<SystemFeatureSourceId, MutableFeaturePatch>();
  const hits = mutableFeaturePatch();
  for (const patch of patches) {
    const sourceIds = new Set([...patch.add.keys(), ...patch.remove.keys()]);
    for (const sourceId of sourceIds) {
      let source = sources.get(sourceId);
      if (!source) {
        source = mutableFeaturePatch();
        sources.set(sourceId, source);
      }
      applyFeaturePatch(source, {
        add: patch.add.get(sourceId) ?? [],
        remove: patch.remove.get(sourceId) ?? [],
      });
    }
    applyFeaturePatch(hits, patch.hitFeatures);
  }
  const add = new Map<SystemFeatureSourceId, readonly RenderFeature[]>();
  const remove = new Map<SystemFeatureSourceId, readonly RenderFeatureId[]>();
  for (const [sourceId, source] of [...sources].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const finished = finishFeaturePatch(source);
    if (finished.add.length > 0) add.set(sourceId, finished.add);
    if (finished.remove.length > 0) remove.set(sourceId, finished.remove);
  }
  const hitFeatures = finishFeaturePatch(hits);
  return { revision, add, remove, hitFeatures, stats: patchStats(add, remove, hitFeatures) };
}

export function filterRenderScenePatch(
  patch: RenderScenePatch,
  sourceIds: ReadonlySet<SystemFeatureSourceId>,
  includeHits: boolean,
): RenderScenePatch {
  const add = new Map([...patch.add].filter(([sourceId]) => sourceIds.has(sourceId)));
  const remove = new Map([...patch.remove].filter(([sourceId]) => sourceIds.has(sourceId)));
  const hitFeatures = includeHits ? patch.hitFeatures : { add: [], remove: [] };
  return {
    revision: patch.revision,
    add,
    remove,
    hitFeatures,
    stats: patchStats(add, remove, hitFeatures),
  };
}

export function renderScenePatchEntryCount(patch: RenderScenePatch): number {
  return (
    [...patch.add.values()].reduce((count, features) => count + features.length, 0) +
    [...patch.remove.values()].reduce((count, featureIds) => count + featureIds.length, 0) +
    patch.hitFeatures.add.length +
    patch.hitFeatures.remove.length
  );
}

export function renderScenePatchSourceCount(patch: RenderScenePatch): number {
  const sourceIds = new Set([...patch.add.keys(), ...patch.remove.keys()]);
  return (
    sourceIds.size +
    (patch.hitFeatures.add.length > 0 || patch.hitFeatures.remove.length > 0 ? 1 : 0)
  );
}
