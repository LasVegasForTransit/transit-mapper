/**
 * One ownership boundary for core preparation, scoped feature projection, and
 * acceptance. Canceled generations keep private counters and results; only a
 * fully accepted continuation may publish them to the live-scene controller.
 */
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import type { RenderCandidateEnvelope } from '@transitmapper/core/render/render-candidate-envelope';
import type {
  RenderPreparationCoordinator,
  RenderPreparedSnapshot,
} from '@transitmapper/core/render/render-preparation';
import { planJournaledRenderPreparation } from '@transitmapper/core/render/render-preparation-update';
import type {
  CooperativeRenderJobScheduler,
  CooperativeRenderJobSchedulerStats,
} from './cooperative-render-job-scheduler';
import {
  planPreparedLiveEntityRenderUpdate,
  type EntityRenderUpdate,
  type PreparedLiveInvalidationTracker,
} from './entity-render-update';
import type {
  GeographicFeatureProjectionPreparationStats,
  PlanResumableGeographicFeatureProjectionOptions,
} from './resumable-feature-projection';
import {
  submitRenderPreparationPipeline,
  type RenderPreparationPipelineHandle,
} from './render-preparation-scheduling';
import type { ResumableGeographicFeatureProjectionContinuation } from './resumable-feature-projection-scheduling';
import {
  createSourceFeatureProjectionCounts,
  mergeSourceFeatureProjectionCounts,
  type SourceFeatureProjectionCounts,
} from './feature-projection-counts';
import type { FeatureProjectionWorkerClient } from './feature-projection-worker';
import { submitWorkerFeatureProjection } from './worker-feature-projection-submission';
import type { SourceUploadTransition } from './sourceUploadPlan';
import type { MapSystemFeatureSourceId } from './system-feature-sources';

export interface SourceFeatureProjectionCountTransaction {
  readonly counts: SourceFeatureProjectionCounts;
  /** Publishes this generation's private counters exactly once. */
  accept(): boolean;
  /** Releases a canceled or failed generation without contaminating totals. */
  discard(): boolean;
}

export interface SourceFeatureProjectionAccounting {
  begin(): SourceFeatureProjectionCountTransaction;
  snapshot(): SourceFeatureProjectionCounts;
}

export interface CommittedFeatureProjectionSubmission {
  /** Null only for Diagram's explicit synchronous Phase 6 fallback. */
  readonly generation: number | null;
  readonly settled: Promise<void>;
  cancel(): boolean;
}

/** Owns durable accepted totals while every in-flight renderer generation
 * writes to an isolated draft. A canceled draft is never observable through
 * performance capture, even when editor work finishes while it is yielded. */
export function createSourceFeatureProjectionAccounting(): SourceFeatureProjectionAccounting {
  const totals = createSourceFeatureProjectionCounts();
  return {
    begin() {
      const counts = createSourceFeatureProjectionCounts();
      let pending = true;
      return {
        counts,
        accept() {
          if (!pending) return false;
          pending = false;
          mergeSourceFeatureProjectionCounts(totals, counts);
          return true;
        },
        discard() {
          if (!pending) return false;
          pending = false;
          return true;
        },
      };
    },
    snapshot: () => ({ ...totals }),
  };
}

export interface PreparedFeatureProjectionTransition {
  readonly previous: TransitSystem;
  readonly next: TransitSystem;
}

export interface PreparedFeatureProjectionCommit {
  readonly features: SystemFeatures;
  readonly preparedSnapshot: RenderPreparedSnapshot;
  readonly sourceIds: readonly MapSystemFeatureSourceId[];
  readonly entityUpdate: EntityRenderUpdate | null;
}

export interface SubmitPreparedCommittedFeatureProjectionOptions {
  readonly scheduler: CooperativeRenderJobScheduler;
  readonly coordinator: RenderPreparationCoordinator;
  readonly liveInvalidation: PreparedLiveInvalidationTracker;
  readonly preparationRevision: string;
  readonly previousLivePreparedSnapshot: RenderPreparedSnapshot | null;
  readonly transition: PreparedFeatureProjectionTransition | null;
  readonly requestedSourceIds: readonly MapSystemFeatureSourceId[];
  readonly intent: 'incremental' | 'reset' | 'style-heal';
  readonly diagramRevision: string;
  readonly candidateEnvelope?: RenderCandidateEnvelope;
  readonly projection: Omit<
    PlanResumableGeographicFeatureProjectionOptions,
    'sourceIds' | 'preparedSnapshot' | 'projectionScope'
  >;
  readonly projectionCounts?: SourceFeatureProjectionCounts;
  /** Geographic feature construction is pure CPU work and the live renderer
   * always delegates it to this persistent worker. Browser-free scheduler
   * coverage lives under `tests/support`, outside the production graph. */
  readonly featureProjectionWorker: FeatureProjectionWorkerClient;
  /** The Diagram solver is independent from geographic preparation. When it
   * is supplied, its immutable schematic snapshot is fed to the same feature
   * worker rather than reconstructing render geometry on the editor thread. */
  layoutDiagram?(
    system: TransitSystem,
    revision: string,
    signal: AbortSignal,
  ): Promise<TransitSystem>;
  now(): number;
  commit(
    input: PreparedFeatureProjectionCommit,
  ): ResumableGeographicFeatureProjectionContinuation | null;
  recordPreparation(stats: GeographicFeatureProjectionPreparationStats): void;
  recordScheduling(stats: CooperativeRenderJobSchedulerStats): void;
}

export interface ScheduleRenderProjectionFailureRetryOptions<Batch> {
  readonly batch: Batch;
  requeue(batch: Batch): void;
  whenRecovered(): Promise<void>;
  schedule(): void;
  completePreviousLease(): void;
  failPreviousLease(error: unknown): void;
}

export interface OwnedCommittedProjectionRequest {
  readonly sourceIds: readonly MapSystemFeatureSourceId[];
  readonly transition: SourceUploadTransition | null;
}

export interface CommittedProjectionOwnershipOptions {
  requeue(request: OwnedCommittedProjectionRequest): void;
}

export interface CommittedProjectionOwnership {
  activate(
    submission: CommittedFeatureProjectionSubmission,
    request: OwnedCommittedProjectionRequest,
  ): void;
  cancelAndRequeue(): boolean;
  clear(submission: CommittedFeatureProjectionSubmission): void;
  current(): CommittedFeatureProjectionSubmission | null;
  afterCurrentSettles(callback: () => void): void;
  dispose(): void;
}

interface OwnedProjection {
  submission: CommittedFeatureProjectionSubmission;
  request: OwnedCommittedProjectionRequest;
}

/**
 * Runs index preparation and feature projection under one ownership lease.
 * The prepared snapshot becomes visible to the live-scene commit only after
 * every private cooperative stage succeeds.
 */
export function submitPreparedCommittedFeatureProjection(
  options: SubmitPreparedCommittedFeatureProjectionOptions,
): RenderPreparationPipelineHandle {
  const system = options.projection.system;
  const previousSystem =
    options.previousLivePreparedSnapshot?.system ?? options.transition?.previous ?? system;
  return submitRenderPreparationPipeline({
    scheduler: options.scheduler,
    coordinator: options.coordinator,
    createPlan: (entityChunkSize) =>
      planJournaledRenderPreparation(options.coordinator, {
        revision: options.preparationRevision,
        previous: previousSystem,
        next: system,
        presentation: options.projection.view.presentation,
        ...(options.candidateEnvelope ? { candidateEnvelope: options.candidateEnvelope } : {}),
        entityChunkSize,
      }),
    continueWith: (preparedSnapshot) => {
      const pending = options.liveInvalidation.record(preparedSnapshot);
      const entityUpdate = planPreparedLiveEntityRenderUpdate({
        intent: options.intent,
        transition: options.transition,
        system,
        viewMode: options.projection.view.viewMode,
        requestedSourceIds: options.requestedSourceIds,
        lastLivePreparedSnapshot: options.previousLivePreparedSnapshot,
        nextPreparedSnapshot: preparedSnapshot,
        ...pending,
      });
      const sourceIds =
        entityUpdate?.kind === 'scoped' ? entityUpdate.sourceIds : options.requestedSourceIds;
      if (sourceIds.length === 0) return null;
      const workerInput = {
        ...options.projection,
        sourceIds,
        ...(entityUpdate?.kind === 'scoped'
          ? { projectionScope: entityUpdate.projectionScope }
          : {}),
        preparedSnapshot,
      };
      return submitWorkerFeatureProjection({
        worker: options.featureProjectionWorker,
        input: async (signal) => {
          if (workerInput.view.viewMode !== 'diagram' || !options.layoutDiagram) {
            return workerInput;
          }
          const diagramSystem = await options.layoutDiagram(
            workerInput.system,
            options.diagramRevision,
            signal,
          );
          return { ...workerInput, diagramSystem };
        },
        onProjected: ({ counts }) => {
          if (counts && options.projectionCounts) {
            mergeSourceFeatureProjectionCounts(options.projectionCounts, counts);
          }
        },
        commit: (features) =>
          options.commit({ features, preparedSnapshot, sourceIds, entityUpdate }),
      });
    },
    now: () => options.now(),
    recordPreparation: (stats) => options.recordPreparation(stats),
    recordScheduling: (stats) => options.recordScheduling(stats),
  });
}

/**
 * Retains the failed batch before waiting for source recovery. The successor
 * lease is scheduled before the predecessor completes, so capture cannot see
 * a false idle gap between recovery and retry.
 */
export function scheduleRenderProjectionFailureRetry<Batch>(
  options: ScheduleRenderProjectionFailureRetryOptions<Batch>,
): void {
  options.requeue(options.batch);
  let recovered: Promise<void>;
  try {
    recovered = options.whenRecovered();
  } catch (error) {
    options.failPreviousLease(error);
    return;
  }
  void recovered.then(
    () => {
      try {
        options.schedule();
        options.completePreviousLease();
      } catch (error) {
        options.failPreviousLease(error);
      }
    },
    (error: unknown) => options.failPreviousLease(error),
  );
}

/** Owns the only projection generation allowed to commit. */
export function createCommittedProjectionOwnership(
  options: CommittedProjectionOwnershipOptions,
): CommittedProjectionOwnership {
  let active: OwnedProjection | null = null;
  let ownershipVersion = 0;
  const cancelAndRequeue = (): boolean => {
    if (!active) return false;
    const canceled = active;
    active = null;
    ownershipVersion += 1;
    canceled.submission.cancel();
    options.requeue(canceled.request);
    return true;
  };
  return {
    activate(submission, request) {
      cancelAndRequeue();
      active = { submission, request };
      ownershipVersion += 1;
    },
    cancelAndRequeue,
    clear(submission) {
      if (active?.submission === submission) active = null;
    },
    current: () => active?.submission ?? null,
    afterCurrentSettles(callback) {
      const awaited = active;
      if (!awaited) {
        callback();
        return;
      }
      const awaitedVersion = ownershipVersion;
      const release = () => {
        if (ownershipVersion !== awaitedVersion) return;
        if (active === awaited) active = null;
        callback();
      };
      const retainForRecovery = () => {
        if (ownershipVersion === awaitedVersion && active === awaited) active = null;
      };
      void awaited.submission.settled.then(release, retainForRecovery);
    },
    dispose() {
      active?.submission.cancel();
      active = null;
      ownershipVersion += 1;
    },
  };
}
