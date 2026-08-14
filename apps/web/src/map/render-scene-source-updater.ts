/**
 * Transactional adapter from logical RenderScene changes to GeoJSON sources.
 * It selects patch versus full upload, exposes bounded CPU materialization and
 * source-mutation units, and advances its retained baseline only at publish.
 */
import type { Feature, FeatureCollection } from 'geojson';
import type { SystemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import type { RenderScenePatch } from '@transitmapper/core/render/render-scene-diff';
import type { RenderScene } from '@transitmapper/core/render/render-scene';
import { createRenderFeatureCollectionMaterialization } from './persistent-render-source-state';
import type {
  ApplyRenderSceneOptions,
  GeoJsonSourceTarget,
  GeoJsonSourceUpdate,
  RenderSceneSourceUpdatePlan,
  RenderSceneSourceUpdateResult,
  RenderSceneSourceUpdater,
  RenderSceneSourceUpdaterOptions,
} from './render-scene-source-contract';
import {
  createFullUpdatePlan,
  createPatchUpdatePlan,
  type MutableSourceUpdaterState,
  type ResolvedFullUpload,
  type ResolvedPatchUpload,
  type ResolvedPatchUploads,
} from './render-scene-source-update-plans';

export type {
  ApplyRenderSceneOptions,
  GeoJsonSourceTarget,
  GeoJsonSourceUpdate,
  RenderSceneSourceMutationUnit,
  RenderSceneSourceUpdatePlan,
  RenderSceneSourceUpdateResult,
  RenderSceneSourceUpdater,
  RenderSceneSourceUpdaterOptions,
  RenderSceneUploadIntent,
} from './render-scene-source-contract';

/** updateData recursively serializes every changed feature before it can
 * return. Keep only genuinely small diffs on that path; larger diffs submit
 * the already-resolved complete collections with setData, which is materially
 * cheaper in the real MapLibre actor and keeps the source swap in one task. */
const MAX_ATOMIC_PATCH_ENTRIES = 64;

const EMPTY_COLLECTION: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

function sourceOrThrow(
  resolveSource: RenderSceneSourceUpdaterOptions['resolveSource'],
  sourceId: SystemFeatureSourceId,
): GeoJsonSourceTarget {
  const source = resolveSource(sourceId);
  if (!source) throw new Error(`Render source target is unavailable: ${sourceId}`);
  return source;
}

function hitSourceOrThrow(
  resolveHitSource: RenderSceneSourceUpdaterOptions['resolveHitSource'],
): GeoJsonSourceTarget {
  const source = resolveHitSource?.();
  if (!source) {
    throw new Error('Render scene has hit features but no hit source target is available.');
  }
  return source;
}

function hitSourceIdOrThrow(hitSourceId: string | undefined): string {
  if (!hitSourceId) throw new Error('A concrete hit source ID is required for source settlement.');
  return hitSourceId;
}

function allSourceIds(previous: RenderScene | null, next: RenderScene): SystemFeatureSourceId[] {
  return [
    ...new Set<SystemFeatureSourceId>([
      ...(previous?.featuresBySource.keys() ?? []),
      ...next.featuresBySource.keys(),
    ]),
  ].sort();
}

function resolveFullUploads(
  updaterOptions: RenderSceneSourceUpdaterOptions,
  previous: RenderScene | null,
  next: RenderScene,
  batchSize: number,
): ResolvedFullUpload[] {
  const uploads: ResolvedFullUpload[] = allSourceIds(previous, next).map((sourceId) => {
    const id = updaterOptions.resolveSourceId?.(sourceId) ?? String(sourceId);
    const collection = next.featuresBySource.get(sourceId) ?? EMPTY_COLLECTION;
    return {
      id,
      source: sourceOrThrow(updaterOptions.resolveSource, sourceId),
      collection,
      materialization: createRenderFeatureCollectionMaterialization({
        id: `render-source:prepare:${id}`,
        collection,
        batchSize,
      }),
    };
  });
  const needsHitSource =
    (previous?.stats.generatedHitFeatureCount ?? 0) > 0 || next.stats.generatedHitFeatureCount > 0;
  const hitSource = needsHitSource
    ? hitSourceOrThrow(updaterOptions.resolveHitSource)
    : updaterOptions.resolveHitSource?.();
  if (hitSource) {
    uploads.push({
      id: hitSourceIdOrThrow(updaterOptions.hitSourceId),
      source: hitSource,
      collection: next.hitFeatures,
      materialization: createRenderFeatureCollectionMaterialization({
        id: `render-source:prepare:${hitSourceIdOrThrow(updaterOptions.hitSourceId)}`,
        collection: next.hitFeatures,
        batchSize,
      }),
    });
  }
  return uploads;
}

function patchPayload(add: readonly Feature[], remove: readonly string[]): GeoJsonSourceUpdate {
  return {
    ...(add.length > 0 ? { add: [...add] } : {}),
    ...(remove.length > 0 ? { remove: [...remove] } : {}),
  };
}

function resolvePatchUploads(
  updaterOptions: RenderSceneSourceUpdaterOptions,
  next: RenderScene,
  suppliedPatch?: RenderScenePatch,
  batchSize = 4,
): ResolvedPatchUploads {
  if (suppliedPatch && suppliedPatch.revision !== next.revision) {
    throw new Error('A supplied render scene patch must target the submitted scene revision.');
  }
  if (!suppliedPatch) {
    throw new Error('An exact staged render scene patch is required after the initial scene.');
  }
  const diff = suppliedPatch;
  const sourceIds = [...new Set([...diff.add.keys(), ...diff.remove.keys()])].sort();
  const uploads: ResolvedPatchUpload[] = sourceIds.map((sourceId) => {
    const id = updaterOptions.resolveSourceId?.(sourceId) ?? String(sourceId);
    const collection = next.featuresBySource.get(sourceId) ?? EMPTY_COLLECTION;
    return {
      id,
      source: sourceOrThrow(updaterOptions.resolveSource, sourceId),
      collection,
      materialization: createRenderFeatureCollectionMaterialization({
        id: `render-source:prepare:${id}`,
        collection,
        batchSize,
      }),
      patch: patchPayload(diff.add.get(sourceId) ?? [], diff.remove.get(sourceId) ?? []),
    };
  });
  const hitPatch = patchPayload(diff.hitFeatures.add, diff.hitFeatures.remove);
  if (diff.hitFeatures.add.length > 0 || diff.hitFeatures.remove.length > 0) {
    uploads.push({
      id: hitSourceIdOrThrow(updaterOptions.hitSourceId),
      source: hitSourceOrThrow(updaterOptions.resolveHitSource),
      collection: next.hitFeatures,
      materialization: createRenderFeatureCollectionMaterialization({
        id: `render-source:prepare:${hitSourceIdOrThrow(updaterOptions.hitSourceId)}`,
        collection: next.hitFeatures,
        batchSize,
      }),
      patch: hitPatch,
    });
  }
  return { uploads, ...diff.stats };
}

function noneResult(): RenderSceneSourceUpdateResult {
  return {
    strategy: 'none',
    sourceUploadCount: 0,
    fullSourceUploadCount: 0,
    patchSourceUploadCount: 0,
    fallbackSourceUploadCount: 0,
    uploadedFeatureCount: 0,
    addedFeatureCount: 0,
    changedFeatureCount: 0,
    removedFeatureCount: 0,
  };
}

function executeSourceUpdatePlan(plan: RenderSceneSourceUpdatePlan): RenderSceneSourceUpdateResult {
  try {
    for (let index = 0; ; index += 1) {
      const unit = plan.preparationUnits?.unitAt(index);
      if (!unit) break;
      unit.run();
    }
    for (const unit of plan.units) unit.run();
    return plan.commit();
  } catch (error) {
    plan.abort();
    throw error;
  }
}

export function createRenderSceneSourceUpdater(
  updaterOptions: RenderSceneSourceUpdaterOptions,
): RenderSceneSourceUpdater {
  const state: MutableSourceUpdaterState = {
    currentScene: null,
    requiresFullUpload: false,
    epoch: 0,
    activeToken: null,
  };

  const prepare = (
    next: RenderScene,
    options: ApplyRenderSceneOptions = {},
  ): RenderSceneSourceUpdatePlan => {
    if (state.activeToken) throw new Error('A render source transaction is already active.');
    const previous = state.currentScene;
    const intent = options.intent ?? 'incremental';
    const preparationBatchSize = options.preparationBatchSize ?? 4;
    if (!Number.isSafeInteger(preparationBatchSize) || preparationBatchSize < 1) {
      throw new RangeError('Source preparation batch size must be a positive integer.');
    }
    const useFullUpload = previous === null || state.requiresFullUpload || intent !== 'incremental';
    const token = {};
    const epoch = state.epoch;
    const plan = useFullUpload
      ? createFullUpdatePlan({
          state,
          token,
          epoch,
          next,
          uploads: resolveFullUploads(updaterOptions, previous, next, preparationBatchSize),
        })
      : createPatchUpdatePlan({
          state,
          token,
          epoch,
          next,
          resolved: resolvePatchUploads(updaterOptions, next, options.patch, preparationBatchSize),
          maxPatchEntries: MAX_ATOMIC_PATCH_ENTRIES,
        });
    state.activeToken = token;
    return plan;
  };

  return {
    prepare,
    apply: (next, options = {}) => executeSourceUpdatePlan(prepare(next, options)),
    invalidateSourceState() {
      state.epoch += 1;
      state.requiresFullUpload = true;
    },
    prepareCurrentSceneHeal() {
      return state.currentScene ? prepare(state.currentScene, { intent: 'style-heal' }) : null;
    },
    healCurrentScene() {
      if (!state.currentScene) return noneResult();
      return executeSourceUpdatePlan(prepare(state.currentScene, { intent: 'style-heal' }));
    },
    currentScene: () => state.currentScene,
  };
}
