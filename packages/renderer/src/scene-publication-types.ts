/**
 * Contract between private scene construction and visible scene publication.
 *
 * Source mutation, bank activation, and CPU-state publication are separate so
 * a failed hidden-bank upload can be abandoned without changing the accepted
 * visible or hit-test revision.
 */
import type {
  CooperativeRenderJobScheduler,
  CooperativeRenderJobSchedulerStats,
  CooperativeRenderJobUnitSequence,
} from './cooperative-render-job-scheduler';
import type { SceneUpdate } from './accepted-scene-store';
import type {
  RenderDomainIdentity,
  RenderFeatureId,
  SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import type { RenderSceneSourceMutationUnit } from './render-scene-source-updater';
import type { SceneDraft, SceneDraftOptions, SceneDraftPlan } from './scene-draft';

interface SceneDraftController<Update> {
  draft(input: SceneUpdate, options?: SceneDraftOptions): SceneDraftPlan;
  preparePublication?(draft: SceneDraft): PreparedScenePublication<Update>;
  publishDraftSynchronously(draft: SceneDraft): Update;
}

export interface PreparedScenePublication<Update> {
  readonly sourceIds: readonly string[];
  readonly clearedSourceIds?: readonly string[];
  readonly preparationUnits?: CooperativeRenderJobUnitSequence<void>;
  readonly units: readonly RenderSceneSourceMutationUnit[];
  readonly mode?: 'active' | 'hidden' | 'seed' | 'unbanked';
  readonly bank?: 'a' | 'b' | null;
  stage?(): unknown;
  markSourcesLoaded?(): void;
  activate?(): void;
  targetsForDomainIdentity?(
    domainIdentity: RenderDomainIdentity,
  ): readonly SceneFeatureStateTarget[];
  publish?(): Update;
  commit(): Update;
  abort(): void;
  mutationStarted(): boolean;
}

export interface PublishSceneDraftOptions<Update> {
  readonly scheduler: CooperativeRenderJobScheduler;
  readonly controller: SceneDraftController<Update>;
  readonly input: SceneUpdate;
  readonly batchSize?: number;
  onSourceMutationStart?(sourceIds: readonly string[], context: ScenePublicationContext): void;
  beforeSourceMutation?(context: ScenePublicationContext): void | Promise<void>;
  beforePublish?(context: ScenePublicationContext): void | Promise<void>;
  beforeScenePublish?(context: ScenePublicationContext): void | Promise<void>;
  onCommitted?(update: Update, context?: ScenePublicationContext): void | Promise<void>;
  onCommitError?(error: Error, context?: ScenePublicationContext): void;
  recordScheduling?(stats: CooperativeRenderJobSchedulerStats): void;
}

export interface ScenePublicationContext {
  readonly sourceIds: readonly string[];
  readonly clearedSourceIds: readonly string[];
  readonly mode?: 'active' | 'hidden' | 'seed' | 'unbanked';
  readonly bank?: 'a' | 'b' | null;
  readonly targetsForDomainIdentity?: (
    domainIdentity: RenderDomainIdentity,
  ) => readonly SceneFeatureStateTarget[];
}

interface SceneFeatureStateTarget {
  readonly sourceId: SystemFeatureSourceId;
  readonly featureId: RenderFeatureId;
}

export interface ScenePublicationSubmission {
  readonly generation: number;
  readonly settled: Promise<void>;
  cancel(): boolean;
}
