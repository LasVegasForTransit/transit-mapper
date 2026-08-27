/**
 * Browser-free adapter for testing the geographic projection scheduler.
 *
 * The editor always gives CPU projection to `feature-projection-worker.ts`.
 * Keeping this synchronous adapter in test support makes that production
 * boundary real while retaining focused scheduler coverage for Diagram and
 * preparation behavior.
 */
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import type {
  CooperativeRenderJobScheduler,
  CooperativeRenderJobSchedulerStats,
} from '../../src/projection/cooperative-render-job-scheduler';
import {
  prepareResumableGeographicFeatureProjection,
  type GeographicFeatureProjectionPreparationStats,
  type PlanResumableGeographicFeatureProjectionOptions,
} from '../../src/projection/resumable-feature-projection';
import type { ResumableGeographicFeatureProjectionContinuation } from '../../src/projection/resumable-feature-projection-scheduling';
import { submitResumableGeographicFeatureProjection } from '../../src/projection/resumable-feature-projection-scheduling';
import { buildFeaturesForSources } from '../../src/projection/source-feature-projection';

export interface SynchronousCommittedFeatureProjectionOptions {
  readonly scheduler: CooperativeRenderJobScheduler;
  readonly projection: PlanResumableGeographicFeatureProjectionOptions;
  readonly preparationStartedAtMs: number;
  readonly diagramRevision?: string;
  layoutDiagram?(
    system: TransitSystem,
    revision: string,
    signal: AbortSignal,
  ): Promise<TransitSystem>;
  now(): number;
  commit(features: SystemFeatures): ResumableGeographicFeatureProjectionContinuation | null;
  recordPreparation(stats: GeographicFeatureProjectionPreparationStats): void;
  recordScheduling(stats: CooperativeRenderJobSchedulerStats): void;
}

export interface SynchronousCommittedFeatureProjectionSubmission {
  readonly generation: number | null;
  readonly settled: Promise<void>;
  cancel(): boolean;
}

/**
 * Reproduces the pre-worker scheduler boundary without making it available to
 * production imports. Tests use it to exercise cancellation and Diagram
 * layout independently from browser Worker transport.
 */
export function submitSynchronousCommittedFeatureProjection(
  options: SynchronousCommittedFeatureProjectionOptions,
): SynchronousCommittedFeatureProjectionSubmission {
  const prepared = prepareResumableGeographicFeatureProjection(options.projection, {
    budgetMs: 4,
    startedAtMs: options.preparationStartedAtMs,
    now: () => options.now(),
  });
  options.recordPreparation(prepared.stats);
  if (prepared.plan.kind === 'deferred') {
    if (options.layoutDiagram) return submitDiagramProjection(options);
    return commitSynchronousFeatures(options);
  }

  const handle = submitResumableGeographicFeatureProjection({
    scheduler: options.scheduler,
    plan: prepared.plan,
    commit: (features) => options.commit(features),
    recordScheduling: (stats) => options.recordScheduling(stats),
  });
  return {
    generation: handle.generation,
    settled: handle.settled.then((settlement) => {
      if (settlement.status === 'failed') throw settlement.error;
    }),
    cancel: () => handle.cancel(),
  };
}

function commitSynchronousFeatures(
  options: SynchronousCommittedFeatureProjectionOptions,
): SynchronousCommittedFeatureProjectionSubmission {
  const continuation = options.commit(buildFeaturesForSources(options.projection));
  return continuation
    ? { generation: null, settled: continuation.settled, cancel: () => continuation.cancel() }
    : { generation: null, settled: Promise.resolve(), cancel: () => false };
}

function submitDiagramProjection(
  options: SynchronousCommittedFeatureProjectionOptions,
): SynchronousCommittedFeatureProjectionSubmission {
  if (!options.layoutDiagram) {
    throw new Error('Diagram projection requires a layout Worker.');
  }
  const abort = new AbortController();
  let continuation: ResumableGeographicFeatureProjectionContinuation | null = null;
  const settled = options
    .layoutDiagram(
      options.projection.system,
      options.diagramRevision ?? options.projection.system.id,
      abort.signal,
    )
    .then((diagramSystem) => {
      if (abort.signal.aborted) throw abort.signal.reason;
      continuation = options.commit(
        buildFeaturesForSources({ ...options.projection, diagramSystem }),
      );
      return continuation?.settled;
    });
  return {
    generation: null,
    settled,
    cancel: () => {
      const canceledWorker = !abort.signal.aborted;
      abort.abort(new DOMException('Diagram layout was superseded.', 'AbortError'));
      const canceledContinuation = continuation?.cancel() ?? false;
      return canceledWorker || canceledContinuation;
    },
  };
}
