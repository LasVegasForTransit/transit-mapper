/**
 * Shared vocabulary for building a RenderScene without publishing it.
 *
 * A draft is private, cancellable work. It may read the accepted scene as its
 * base, but no MapLibre source or accepted controller state changes until the
 * separate publication step succeeds.
 */
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import type {
  RenderDomainIdentity,
  SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import type { RenderScene, RenderSceneStats } from '@transitmapper/core/render/render-scene';
import type { RenderScenePatch } from '@transitmapper/core/render/render-scene-diff';
import type { IncrementalLiveSceneState } from './accepted-scene-state';
import type { CooperativeRenderJobUnitSequence } from './projection/cooperative-render-job-scheduler';
import type { RenderSceneUploadIntent } from './sources/render-scene-source-contract';
import type {
  IncrementalSceneOperationCounts,
  IncrementalSourceState,
} from './sources/scene-source-state';
import type { MapSystemFeatureSourceId } from './system-feature-sources';

export type { SceneDraftWorkUnit } from './scene-draft-work';

export interface SceneDraftOptions {
  /** Maximum raw features visited by an ordinary unit. Merge and index units
   * use the same bound, so lowering it refines every resumable stage. */
  readonly batchSize?: number;
}

export interface BuildSceneDraftInput {
  readonly previous: IncrementalLiveSceneState | null;
  readonly revision: string;
  readonly features: SystemFeatures;
  readonly sourceIds: readonly MapSystemFeatureSourceId[];
  readonly replacementDomainsBySource?: ReadonlyMap<
    MapSystemFeatureSourceId,
    readonly RenderDomainIdentity[]
  >;
  readonly stats?: RenderSceneStats;
  readonly counts?: IncrementalSceneOperationCounts;
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
