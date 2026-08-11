/**
 * Publishes one private scene draft as the next accepted renderer revision.
 *
 * The pipeline drains draft work, prepares source mutations, waits for hidden
 * bank readiness, switches visual and hit ownership, and only then publishes
 * controller state. Cancellation or failure before that point leaves the
 * previously accepted scene authoritative.
 */
import {
  CooperativeRenderUnitBudgetError,
  type CooperativeRenderJobHandle,
  type CooperativeRenderJobScheduler,
  type CooperativeRenderJobSchedulerStats,
  type CooperativeRenderJobSettlement,
} from './cooperative-render-job-scheduler';
import type {
  ScenePublicationSubmission,
  PreparedScenePublication,
  ScenePublicationContext,
  PublishSceneDraftOptions,
} from './scene-publication-types';
import {
  createScenePublicationAttempt,
  scenePublicationUnits,
  sourcePublicationContext,
  toPublicationError,
  type ScenePublicationAttempt,
} from './scene-publication-attempt';

export type {
  SceneFeatureStateTarget,
  SceneDraftController,
  ScenePublicationSubmission,
  PreparedScenePublication,
  ScenePublicationContext,
  PublishSceneDraftOptions,
} from './scene-publication-types';

// Cold RTC evidence resolves safely at four. Starting there avoids spending a
// frame on a known-oversized draft while preserving adaptive 4 → 2 → 1
// recovery for slower devices.
const DEFAULT_BATCH_SIZE = 4;
const latestSubmissionByScheduler = new WeakMap<CooperativeRenderJobScheduler, object>();

class ScenePublicationPipeline<Update> {
  private readonly ownership = {};
  private readonly retriedBatchSizes = new Set<number>();
  private logicalGeneration = 0;
  private currentJob: CooperativeRenderJobHandle | null = null;
  private currentAttempt: ScenePublicationAttempt<Update> | null = null;
  private minimalContinuityAttemptUsed = false;
  private finished = false;
  private resolveSettlement: () => void = () => {};
  private rejectSettlement: (error: unknown) => void = () => {};
  private readonly settled = new Promise<void>((resolve, reject) => {
    this.resolveSettlement = resolve;
    this.rejectSettlement = reject;
  });

  constructor(private readonly options: PublishSceneDraftOptions<Update>) {
    latestSubmissionByScheduler.set(options.scheduler, this.ownership);
  }

  start(): ScenePublicationSubmission {
    this.scheduleAttempt(this.options.batchSize ?? DEFAULT_BATCH_SIZE);
    return {
      generation: this.logicalGeneration,
      settled: this.settled,
      cancel: () => this.cancel(),
    };
  }

  private ownsGeneration(): boolean {
    return latestSubmissionByScheduler.get(this.options.scheduler) === this.ownership;
  }

  private scheduleAttempt(batchSize: number, tolerateBudgetOverrun = false): void {
    if (!this.ownsGeneration()) return;
    const attempt = createScenePublicationAttempt<Update>(batchSize, tolerateBudgetOverrun);
    const scheduled = this.options.scheduler.submit({
      units: scenePublicationUnits(this.options, attempt),
      ...(attempt.tolerateBudgetOverrun
        ? {
            overBudgetUnitPolicy: 'yield' as const,
            overBudgetYieldUnitIds: attempt.overBudgetYieldUnitIds,
          }
        : {}),
      commit: () => this.commitAttempt(attempt),
    });
    this.currentJob = scheduled;
    this.currentAttempt = attempt;
    if (this.logicalGeneration === 0) this.logicalGeneration = scheduled.generation;
    void Promise.all([scheduled.settled, scheduled.stats]).then(([settlement, stats]) => {
      this.completeAttempt(attempt, settlement, stats);
    });
  }

  private commitAttempt(attempt: ScenePublicationAttempt<Update>): void {
    if (!attempt.plan) throw new Error('The scene publication plan was not created.');
    try {
      const sourceCommit = attempt.sourceCommit;
      if (sourceCommit?.stage && sourceCommit.publish) {
        sourceCommit.stage();
        attempt.sourceStaged = true;
        attempt.postCommitSettlement = this.publishAfterSourceReady(attempt, sourceCommit);
        return;
      }
      // Legacy browser-free controllers retain their synchronous publication
      // contract. Production MapLibre uses the split path above.
      const update = sourceCommit
        ? sourceCommit.commit()
        : this.options.controller.publishDraftSynchronously(attempt.plan.result());
      attempt.sourcePublished = true;
      attempt.postCommitSettlement = Promise.resolve(this.options.onCommitted?.(update));
    } catch (thrown) {
      const error = toPublicationError(thrown);
      try {
        this.options.onCommitError?.(error);
        attempt.commitErrorReported = true;
      } catch {
        // Recovery diagnostics cannot replace the authoritative source error.
      }
      throw error;
    }
  }

  private async publishAfterSourceReady(
    attempt: ScenePublicationAttempt<Update>,
    sourceCommit: PreparedScenePublication<Update>,
  ): Promise<void> {
    const context = this.publicationContext(sourceCommit);
    await this.options.beforePublish?.(context);
    sourceCommit.markSourcesLoaded?.();
    sourceCommit.activate?.();
    await this.options.beforeScenePublish?.(context);
    if (!sourceCommit.publish) throw new Error('Staged source publication is unavailable.');
    const update = sourceCommit.publish();
    attempt.sourcePublished = true;
    await this.options.onCommitted?.(update, context);
  }

  private publicationContext(
    sourceCommit: PreparedScenePublication<Update>,
  ): ScenePublicationContext {
    return sourcePublicationContext(sourceCommit);
  }

  private completeAttempt(
    attempt: ScenePublicationAttempt<Update>,
    settlement: CooperativeRenderJobSettlement,
    stats: CooperativeRenderJobSchedulerStats,
  ): void {
    if (settlement.status !== 'committed') attempt.sourceCommit?.abort();
    this.reportFailedSourceMutation(attempt, settlement);
    this.recordScheduling(stats);
    if (!this.ownsGeneration()) {
      this.finish();
      return;
    }
    if (settlement.status === 'committed') {
      this.finishAfterPaint(attempt);
      return;
    }
    if (this.retryBudgetFailure(attempt, settlement)) return;
    if (settlement.status === 'failed') {
      this.finish(settlement.error);
      return;
    }
    this.finish();
  }

  private reportFailedSourceMutation(
    attempt: ScenePublicationAttempt<Update>,
    settlement: CooperativeRenderJobSettlement,
  ): void {
    const sourceCommit = attempt.sourceCommit;
    if (
      settlement.status !== 'failed' ||
      sourceCommit?.mutationStarted() !== true ||
      attempt.commitErrorReported
    ) {
      return;
    }
    try {
      this.options.onCommitError?.(settlement.error, this.publicationContext(sourceCommit));
      attempt.commitErrorReported = true;
    } catch {
      // Recovery diagnostics cannot replace the source boundary failure.
    }
  }

  private recordScheduling(stats: CooperativeRenderJobSchedulerStats): void {
    try {
      this.options.recordScheduling?.(stats);
    } catch {
      // Diagnostics must not strand the renderer settlement barrier.
    }
  }

  private finishAfterPaint(attempt: ScenePublicationAttempt<Update>): void {
    const settlement = attempt.postCommitSettlement;
    if (!settlement) {
      this.finish();
      return;
    }
    void settlement.then(
      () => this.finish(),
      (thrown: unknown) => {
        const error = toPublicationError(thrown);
        if (!attempt.sourcePublished) attempt.sourceCommit?.abort();
        if (!attempt.commitErrorReported) {
          try {
            this.options.onCommitError?.(
              error,
              attempt.sourceCommit ? this.publicationContext(attempt.sourceCommit) : undefined,
            );
            attempt.commitErrorReported = true;
          } catch {
            // Recovery diagnostics cannot replace paint settlement failure.
          }
        }
        this.finish(error);
      },
    );
  }

  private retryBudgetFailure(
    attempt: ScenePublicationAttempt<Update>,
    settlement: CooperativeRenderJobSettlement,
  ): boolean {
    if (
      settlement.status !== 'failed' ||
      !(settlement.error instanceof CooperativeRenderUnitBudgetError) ||
      attempt.sourceCommit?.mutationStarted() === true
    ) {
      return false;
    }
    if (!this.retriedBatchSizes.has(attempt.batchSize)) {
      this.retriedBatchSizes.add(attempt.batchSize);
      this.scheduleAttempt(attempt.batchSize);
      return true;
    }
    if (attempt.batchSize > 1) {
      this.scheduleAttempt(Math.max(1, Math.floor(attempt.batchSize / 2)));
      return true;
    }
    if (this.minimalContinuityAttemptUsed) return false;
    this.minimalContinuityAttemptUsed = true;
    // A batch-one unit is already structurally indivisible. Its elapsed time
    // still reaches scheduler/perf maxima, but a GC/JIT pause must not turn
    // renderer timing into a correctness gate that leaves a valid city blank.
    // The tolerant attempt yields immediately after any observed overrun.
    this.scheduleAttempt(1, true);
    return true;
  }

  private cancel(): boolean {
    if (this.finished) return false;
    // Source publication is irreversible at this boundary. Its optional
    // paint barrier must settle (or request recovery) instead of pretending
    // the prior controller revision can be restored by cancellation.
    if (
      this.currentAttempt?.sourcePublished ||
      this.currentAttempt?.sourceStaged ||
      this.currentAttempt?.sourceCommit?.mutationStarted() === true
    ) {
      return false;
    }
    if (this.ownsGeneration()) latestSubmissionByScheduler.delete(this.options.scheduler);
    const currentJob = this.currentJob;
    this.currentAttempt?.sourceCommit?.abort();
    if (currentJob) this.options.scheduler.cancel(currentJob.generation);
    this.finish();
    return true;
  }

  private finish(error?: Error): void {
    if (this.finished) return;
    this.finished = true;
    if (this.ownsGeneration()) latestSubmissionByScheduler.delete(this.options.scheduler);
    if (error) this.rejectSettlement(error);
    else this.resolveSettlement();
  }
}

/** Builds normalization, scoped merge, hit reconstruction, and source diff in
 * measured private units. Only the prepared terminal transaction may publish
 * the next retained scene and its already-built source patch. */
export function publishSceneDraft<Update>(
  options: PublishSceneDraftOptions<Update>,
): ScenePublicationSubmission {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError('The scene publication batch size must be a positive integer.');
  }
  return new ScenePublicationPipeline(options).start();
}
