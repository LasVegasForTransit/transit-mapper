/**
 * The browser-facing contract between an accepted render scene and MapLibre.
 *
 * Plan builders describe a transaction through these records. The source
 * updater executes it, while publication code schedules it. Keeping the
 * contract separate prevents either side from importing the other's behavior
 * just to name a source, patch, or staged transaction.
 */
import type { Feature, FeatureCollection } from 'geojson';
import type { SystemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import type { RenderScenePatch } from '@transitmapper/core/render/render-scene-diff';
import type { RenderScene } from '@transitmapper/core/render/render-scene';
import type { CooperativeRenderJobUnitSequence } from './projection/cooperative-render-job-scheduler';

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
   * Its revision must match `scene`. Incremental submissions after initial
   * load require this exact patch: calculating a whole-scene diff here could
   * turn one large feature into an unbounded MapLibre scheduling task. */
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

export interface RenderSceneSourceMutationUnit {
  readonly id: string;
  readonly sliceExclusive: true;
  run(): void;
}

export interface RenderSceneSourceUpdatePlan {
  readonly strategy: 'none' | 'full' | 'patch';
  /** Exact MapLibre source targets mutated by this transaction. */
  readonly sourceIds: readonly string[];
  /** Targets whose next revision contains no geometry. A banked renderer keeps
   * their incoming layers absent at activation, so no stale geometry can leak
   * while MapLibre has no content event to acknowledge for an empty update. */
  readonly clearedSourceIds?: readonly string[];
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
