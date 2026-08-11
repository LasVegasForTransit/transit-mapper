/**
 * Transactional adapter from logical RenderScene changes to GeoJSON sources.
 * It selects patch versus full upload, exposes bounded CPU materialization and
 * source-mutation units, and advances its retained baseline only at publish.
 */
import type { Feature, FeatureCollection } from 'geojson';
import type { SystemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import type { RenderScenePatch } from '@transitmapper/core/render/render-scene-diff';
import type { RenderScene } from '@transitmapper/core/render/render-scene';
import type { CooperativeRenderJobUnitSequence } from './cooperative-render-job-scheduler';
import { createRenderFeatureCollectionMaterialization } from './persistent-render-source-state';
import {
  createFullUpdatePlan,
  createPatchUpdatePlan,
  type MutableSourceUpdaterState,
  type ResolvedFullUpload,
  type ResolvedPatchUpload,
  type ResolvedPatchUploads,
} from './render-scene-source-update-plans';

export interface GeoJsonSourceUpdate {
  add?: Feature[];
  remove?: (string | number)[];
}

/** The synchronous part of MapLibre's GeoJSONSource contract used here.
 * Keeping this structural boundary browser-free makes source scheduling and
 * failure recovery testable without constructing a map or WebGL context. */
export interface GeoJsonSourceTarget {
  setData(data: FeatureCollection): unknown;
  updateData(data: GeoJsonSourceUpdate): unknown;
}

export type RenderSceneUploadIntent = 'incremental' | 'reset' | 'style-heal';

export interface ApplyRenderSceneOptions {
  intent?: RenderSceneUploadIntent;
  /** Exact logical sources owned by this transaction. Composite live
   * boundaries route committed banked and transient editor collections
   * without inferring ownership from empty collections. */
  requestedSourceIds?: readonly SystemFeatureSourceId[];
  /** Precomputed exact patch for callers that retain source-local scene state.
   * Its revision must match `scene`. Omitting it keeps the general full-scene
   * diff path for consumers without incremental source knowledge. */
  patch?: RenderScenePatch;
  /** Adaptive batch bound for exact CPU collection materialization that must
   * finish before a full MapLibre source call. */
  preparationBatchSize?: number;
}

export interface RenderSceneSourceUpdateResult {
  strategy: 'none' | 'full' | 'patch';
  sourceUploadCount: number;
  fullSourceUploadCount: number;
  patchSourceUploadCount: number;
  fallbackSourceUploadCount: number;
  uploadedFeatureCount: number;
  addedFeatureCount: number;
  changedFeatureCount: number;
  removedFeatureCount: number;
}

export interface RenderSceneSourceUpdaterOptions {
  resolveSource: (sourceId: SystemFeatureSourceId) => GeoJsonSourceTarget | undefined;
  /** Physical MapLibre source identity for a logical render source. Banked
   * renderers use this without changing the core scene/source contract. */
  resolveSourceId?: (sourceId: SystemFeatureSourceId) => string;
  resolveHitSource?: () => GeoJsonSourceTarget | undefined;
  /** Concrete MapLibre source name for hit geometry. Required whenever a hit
   * target is present so paint settlement never waits on a semantic alias. */
  hitSourceId?: string;
}

export interface RenderSceneSourceUpdater {
  /** Resolve one exact scene transaction. Full/reset uploads expose one
   * slice-exclusive unit per source; retained scene identity advances only in
   * `commit()` after every unit has succeeded. */
  prepare(scene: RenderScene, options?: ApplyRenderSceneOptions): RenderSceneSourceUpdatePlan;
  apply(scene: RenderScene, options?: ApplyRenderSceneOptions): RenderSceneSourceUpdateResult;
  /** Mark the last submitted MapLibre state uncertain after an asynchronous
   * source error or a style/source epoch replacement. MapLibre reports worker
   * failures through events, not by throwing from updateData(). */
  invalidateSourceState(): void;
  prepareCurrentSceneHeal(): RenderSceneSourceUpdatePlan | null;
  /** Re-submit the current complete scene with setData(), without projecting or
   * diffing model geometry again. Returns a no-op before the first scene. */
  healCurrentScene(): RenderSceneSourceUpdateResult;
  currentScene(): RenderScene | null;
}

export interface RenderSceneSourceMutationUnit {
  readonly id: string;
  readonly sliceExclusive: true;
  run(): void;
}

export interface RenderSceneSourceUpdatePlan {
  readonly strategy: 'none' | 'full' | 'patch';
  /** Exact MapLibre source targets mutated by this transaction. */
  readonly sourceIds: readonly string[];
  readonly units: readonly RenderSceneSourceMutationUnit[];
  /** Exact resumable CPU work required by a later full source mutation. These
   * units never call MapLibre and may therefore participate in batch retry. */
  readonly preparationUnits?: CooperativeRenderJobUnitSequence<void>;
  /** Present only for the dual-bank MapLibre boundary. */
  readonly mode?: 'active' | 'hidden' | 'seed' | 'unbanked';
  readonly bank?: 'a' | 'b' | null;
  /** Validates the complete source submission but retains the previously
   * published CPU scene until its worker/load boundary is accepted. */
  stage(): RenderSceneSourceUpdateResult;
  /** Advances the CPU scene after a staged source revision is safe to expose. */
  publish(): void;
  /** A hidden bank records exact source-loaded evidence before publication. */
  markSourcesLoaded?(): void;
  /** Transfers synchronous physical source/layer ownership after hidden source
   * readiness, while the prior CPU scene remains published through paint. */
  activate?(): void;
  /** Synchronous compatibility path for non-MapLibre consumers. */
  commit(): RenderSceneSourceUpdateResult;
  /** Abandon a canceled generation. Once any source changed, the next
   * generation must perform a complete upload from retained scene state. */
  abort(): void;
  mutationStarted(): boolean;
}

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
