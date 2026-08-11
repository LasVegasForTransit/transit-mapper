/**
 * Shared vocabulary for building a RenderScene without publishing it.
 *
 * A draft is private, cancellable work. It may read the accepted scene as its
 * base, but no MapLibre source or accepted controller state changes until the
 * separate publication step succeeds.
 */
import type { SystemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import type { RenderScene } from '@transitmapper/core/render/render-scene';
import type { RenderScenePatch } from '@transitmapper/core/render/render-scene-diff';
import type { CooperativeRenderJobUnitSequence } from './cooperative-render-job-scheduler';
import type {
  BuildIncrementalLiveSceneInput,
  IncrementalLiveSceneState,
} from './synchronous-scene-draft';
import type { IncrementalSourceState } from './scene-source-state';
import type { RenderSceneUploadIntent } from './render-scene-source-updater';

export interface SceneDraftWorkUnit {
  readonly id: string;
  run(): void;
}

export interface SceneDraftOptions {
  /** Maximum raw features visited by an ordinary unit. Merge and index units
   * use the same bound, so lowering it refines every resumable stage. */
  readonly batchSize?: number;
}

export interface BuildSceneDraftInput extends BuildIncrementalLiveSceneInput {
  readonly intent?: RenderSceneUploadIntent;
  /** Controller-local ownership prevents a prepared transaction from being
   * published through a different live source boundary. */
  readonly owner: object;
}

export interface SceneDraft {
  readonly owner: object;
  /** Adaptive work bound retained for any exact source materialization that
   * becomes necessary only after the MapLibre upload strategy is selected. */
  readonly batchSize: number;
  readonly baseState: IncrementalLiveSceneState | null;
  readonly baseSourceStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>;
  readonly state: IncrementalLiveSceneState;
  readonly scene: RenderScene;
  readonly patch: RenderScenePatch;
  readonly requestedSourceIds: readonly SystemFeatureSourceId[];
  readonly intent: RenderSceneUploadIntent;
}

export interface SceneDraftPlan {
  readonly units: CooperativeRenderJobUnitSequence<void>;
  /** Constant-time after `units` has returned undefined. */
  result(): SceneDraft;
}
