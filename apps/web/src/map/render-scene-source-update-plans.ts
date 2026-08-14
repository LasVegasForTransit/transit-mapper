import type { FeatureCollection } from 'geojson';
import type { RenderScene } from '@transitmapper/core/render/render-scene';
import type {
  GeoJsonSourceTarget,
  GeoJsonSourceUpdate,
  RenderSceneSourceMutationUnit,
  RenderSceneSourceUpdatePlan,
  RenderSceneSourceUpdateResult,
} from './render-scene-source-updater';
import type { RenderFeatureCollectionMaterialization } from './persistent-render-source-state';
import type { SceneDraftWorkUnit } from './scene-draft-types';

export interface ResolvedFullUpload {
  id: string;
  source: GeoJsonSourceTarget;
  collection: FeatureCollection;
  materialization: RenderFeatureCollectionMaterialization | null;
}

export interface ResolvedPatchUpload extends ResolvedFullUpload {
  patch: GeoJsonSourceUpdate;
}

export interface ResolvedPatchUploads {
  uploads: ResolvedPatchUpload[];
  addedFeatureCount: number;
  changedFeatureCount: number;
  removedFeatureCount: number;
}

export interface MutableSourceUpdaterState {
  currentScene: RenderScene | null;
  requiresFullUpload: boolean;
  epoch: number;
  activeToken: object | null;
}

interface MutableUpdateCounts {
  sourceUploadCount: number;
  fullSourceUploadCount: number;
  patchSourceUploadCount: number;
  fallbackSourceUploadCount: number;
  uploadedFeatureCount: number;
}

interface FullUpdatePlanOptions {
  state: MutableSourceUpdaterState;
  token: object;
  epoch: number;
  next: RenderScene;
  uploads: readonly ResolvedFullUpload[];
  promotedFromPatch?: boolean;
}

interface PatchUpdatePlanOptions {
  state: MutableSourceUpdaterState;
  token: object;
  epoch: number;
  next: RenderScene;
  resolved: ResolvedPatchUploads;
  maxPatchEntries: number;
}

function emptyCounts(): MutableUpdateCounts {
  return {
    sourceUploadCount: 0,
    fullSourceUploadCount: 0,
    patchSourceUploadCount: 0,
    fallbackSourceUploadCount: 0,
    uploadedFeatureCount: 0,
  };
}

function fullResult(counts: MutableUpdateCounts): RenderSceneSourceUpdateResult {
  return {
    strategy: 'full',
    ...counts,
    addedFeatureCount: 0,
    changedFeatureCount: 0,
    removedFeatureCount: 0,
  };
}

function patchResult(
  counts: MutableUpdateCounts,
  stats: Omit<ResolvedPatchUploads, 'uploads'>,
): RenderSceneSourceUpdateResult {
  return {
    strategy: counts.sourceUploadCount === 0 ? 'none' : 'patch',
    ...counts,
    ...stats,
  };
}

function requireActiveTransaction(state: MutableSourceUpdaterState, token: object): void {
  if (state.activeToken !== token) {
    throw new Error('Render source transaction is stale or no longer active.');
  }
}

function fullUploadPreparation(uploads: readonly ResolvedFullUpload[]): {
  sequence: NonNullable<RenderSceneSourceUpdatePlan['preparationUnits']>;
  complete(): boolean;
} {
  let uploadIndex = 0;
  let lastIndex = -1;
  let lastUnit: SceneDraftWorkUnit | undefined;
  let exhausted = uploads.every((upload) => upload.materialization === null);
  const sequence = {
    unitAt(index: number): SceneDraftWorkUnit | undefined {
      if (index === lastIndex) return lastUnit;
      if (index !== lastIndex + 1) {
        throw new RangeError('Source preparation units must be requested in order.');
      }
      lastIndex = index;
      while (uploadIndex < uploads.length) {
        const materialization = uploads[uploadIndex].materialization;
        if (!materialization) {
          uploadIndex += 1;
          continue;
        }
        const work = materialization.nextWork();
        if (work) {
          lastUnit = work;
          return work;
        }
        uploads[uploadIndex].collection = materialization.result();
        uploadIndex += 1;
      }
      exhausted = true;
      lastUnit = undefined;
      return undefined;
    },
  };
  return { sequence, complete: () => exhausted };
}

const EMPTY_PREPARATION_UNITS: NonNullable<RenderSceneSourceUpdatePlan['preparationUnits']> = {
  unitAt: () => undefined,
};

interface FullMutationSequenceOptions {
  readonly state: MutableSourceUpdaterState;
  readonly token: object;
  readonly uploads: readonly ResolvedFullUpload[];
  readonly preparation: ReturnType<typeof fullUploadPreparation>;
  readonly counts: MutableUpdateCounts;
  readonly promotedFromPatch: boolean;
  readonly fail: () => void;
}

interface MutationSequence {
  readonly units: readonly RenderSceneSourceMutationUnit[];
  readonly complete: () => boolean;
  readonly mutationStarted: () => boolean;
}

/** Full uploads are deliberately one source per unit: callers can stage a hidden
 * renderer bank between frames, but publication still waits for every source. */
function createFullMutationSequence({
  state,
  token,
  uploads,
  preparation,
  counts,
  promotedFromPatch,
  fail,
}: FullMutationSequenceOptions): MutationSequence {
  let completedUnits = 0;
  let started = false;
  const units: readonly RenderSceneSourceMutationUnit[] = uploads.map((upload, index) => ({
    id: `render-source:${promotedFromPatch ? 'promoted-full' : 'full'}:${upload.id}`,
    sliceExclusive: true,
    run() {
      requireActiveTransaction(state, token);
      if (!preparation.complete()) {
        throw new Error('Render source preparation must complete before source mutation.');
      }
      if (index !== completedUnits) {
        throw new Error('Render source transaction units must run in order.');
      }
      started = true;
      try {
        counts.sourceUploadCount += 1;
        counts.fullSourceUploadCount += 1;
        counts.uploadedFeatureCount += upload.collection.features.length;
        upload.source.setData(upload.collection);
        completedUnits += 1;
      } catch (error) {
        fail();
        throw error;
      }
    },
  }));
  return {
    units,
    complete: () => completedUnits === uploads.length,
    mutationStarted: () => started,
  };
}

interface PatchMutationSequenceOptions {
  readonly state: MutableSourceUpdaterState;
  readonly token: object;
  readonly uploads: readonly ResolvedPatchUpload[];
  readonly counts: MutableUpdateCounts;
  readonly fail: () => void;
}

/** A small patch stays one unit so visible sources never receive only part of
 * the same logical change before the updater has either completed or failed. */
function createPatchMutationSequence({
  state,
  token,
  uploads,
  counts,
  fail,
}: PatchMutationSequenceOptions): MutationSequence {
  let completed = uploads.length === 0;
  let started = false;
  const units: readonly RenderSceneSourceMutationUnit[] =
    uploads.length === 0
      ? []
      : [
          {
            id: 'render-source:atomic:patch',
            sliceExclusive: true,
            run() {
              requireActiveTransaction(state, token);
              if (completed) throw new Error('Render source transaction unit already ran.');
              started = true;
              try {
                for (const upload of uploads) {
                  counts.sourceUploadCount += 1;
                  counts.patchSourceUploadCount += 1;
                  counts.uploadedFeatureCount +=
                    (upload.patch.add?.length ?? 0) + (upload.patch.remove?.length ?? 0);
                  upload.source.updateData(upload.patch);
                }
                completed = true;
              } catch (error) {
                fail();
                throw error;
              }
            },
          },
        ];
  return { units, complete: () => completed, mutationStarted: () => started };
}

export function createFullUpdatePlan({
  state,
  token,
  epoch,
  next,
  uploads,
  promotedFromPatch = false,
}: FullUpdatePlanOptions): RenderSceneSourceUpdatePlan {
  const counts = emptyCounts();
  let failed = false;
  let staged = false;
  const preparation = fullUploadPreparation(uploads);
  const fail = () => {
    failed = true;
    state.requiresFullUpload = true;
    state.activeToken = null;
  };
  const mutations = createFullMutationSequence({
    state,
    token,
    uploads,
    preparation,
    counts,
    promotedFromPatch,
    fail,
  });
  const { units } = mutations;
  if (promotedFromPatch) counts.fallbackSourceUploadCount = uploads.length;
  return {
    strategy: 'full',
    sourceIds: uploads.map((upload) => upload.id),
    preparationUnits: preparation.sequence,
    units,
    stage() {
      if (failed) throw new Error('Render source transaction failed and cannot be published.');
      requireActiveTransaction(state, token);
      if (!preparation.complete()) {
        throw new Error('Render source preparation is incomplete and cannot be published.');
      }
      if (state.epoch !== epoch) {
        fail();
        throw new Error('Render source transaction was invalidated before publication.');
      }
      if (!mutations.complete()) {
        throw new Error('Render source transaction is incomplete and cannot be published.');
      }
      staged = true;
      return fullResult(counts);
    },
    publish() {
      requireActiveTransaction(state, token);
      if (!staged) throw new Error('Render source transaction must be staged before publication.');
      if (state.epoch !== epoch) {
        fail();
        throw new Error('Render source transaction was invalidated before publication.');
      }
      state.currentScene = next;
      state.requiresFullUpload = false;
      state.activeToken = null;
    },
    commit() {
      const result = this.stage();
      this.publish();
      return result;
    },
    abort() {
      if (state.activeToken !== token) return;
      if (mutations.mutationStarted()) state.requiresFullUpload = true;
      state.activeToken = null;
    },
    mutationStarted: () => mutations.mutationStarted(),
  };
}

function promotePatchToFull({
  state,
  token,
  epoch,
  next,
  resolved,
  maxPatchEntries,
}: PatchUpdatePlanOptions): RenderSceneSourceUpdatePlan | null {
  const patchEntryCount = resolved.uploads.reduce(
    (count, upload) => count + (upload.patch.add?.length ?? 0) + (upload.patch.remove?.length ?? 0),
    0,
  );
  if (patchEntryCount <= maxPatchEntries) return null;
  return createFullUpdatePlan({
    state,
    token,
    epoch,
    next,
    uploads: resolved.uploads,
    promotedFromPatch: true,
  });
}

export function createPatchUpdatePlan({
  state,
  token,
  epoch,
  next,
  resolved,
  maxPatchEntries,
}: PatchUpdatePlanOptions): RenderSceneSourceUpdatePlan {
  const promoted = promotePatchToFull({ state, token, epoch, next, resolved, maxPatchEntries });
  if (promoted) return promoted;
  const counts = emptyCounts();
  let failed = false;
  let staged = false;
  const fail = () => {
    failed = true;
    state.activeToken = null;
    state.requiresFullUpload = true;
  };
  const mutations = createPatchMutationSequence({
    state,
    token,
    uploads: resolved.uploads,
    counts,
    fail,
  });
  const { units } = mutations;
  return {
    strategy: resolved.uploads.length === 0 ? 'none' : 'patch',
    sourceIds: resolved.uploads.map((upload) => upload.id),
    preparationUnits: EMPTY_PREPARATION_UNITS,
    units,
    stage() {
      if (failed) throw new Error('Render source transaction failed and cannot be published.');
      requireActiveTransaction(state, token);
      if (state.epoch !== epoch) {
        fail();
        throw new Error('Render source transaction was invalidated before publication.');
      }
      if (!mutations.complete()) {
        throw new Error('Render source transaction is incomplete and cannot be published.');
      }
      staged = true;
      return patchResult(counts, {
        addedFeatureCount: resolved.addedFeatureCount,
        changedFeatureCount: resolved.changedFeatureCount,
        removedFeatureCount: resolved.removedFeatureCount,
      });
    },
    publish() {
      requireActiveTransaction(state, token);
      if (!staged) throw new Error('Render source transaction must be staged before publication.');
      if (state.epoch !== epoch) {
        fail();
        throw new Error('Render source transaction was invalidated before publication.');
      }
      state.currentScene = next;
      state.requiresFullUpload = false;
      state.activeToken = null;
    },
    commit() {
      const result = this.stage();
      this.publish();
      return result;
    },
    abort() {
      if (state.activeToken !== token) return;
      if (mutations.mutationStarted()) state.requiresFullUpload = true;
      state.activeToken = null;
    },
    mutationStarted: () => mutations.mutationStarted(),
  };
}
