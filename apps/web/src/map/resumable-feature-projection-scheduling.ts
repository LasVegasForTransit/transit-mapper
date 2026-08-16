import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import type {
  CooperativeRenderCommitContext,
  CooperativeRenderJobHandle,
  CooperativeRenderJobSettlement,
  CooperativeRenderJobScheduler,
  CooperativeRenderJobSchedulerStats,
} from './cooperative-render-job-scheduler';
import { CooperativeRenderUnitBudgetError } from './cooperative-render-job-scheduler';
import { planResumableFeatureProjectionAggregation } from './resumable-feature-projection-aggregation';
import type { ResumableGeographicFeatureProjectionPlan } from './resumable-feature-projection';
import {
  createSourceFeatureProjectionCounts,
  type SourceFeatureProjectionCounts,
} from './sourceFeatureProjection';

type ReadyProjectionPlan = Extract<ResumableGeographicFeatureProjectionPlan, { kind: 'ready' }>;

export interface ResumableGeographicFeatureProjectionHandle extends CooperativeRenderJobHandle {
  /** Cancels whichever physical retry currently owns this logical generation. */
  cancel(): boolean;
}

export interface ResumableGeographicFeatureProjectionContinuation {
  readonly settled: Promise<void>;
  cancel(): boolean;
}

const latestSubmissionByScheduler = new WeakMap<CooperativeRenderJobScheduler, object>();

const COUNT_STATS = [
  'submittedJobCount',
  'committedJobCount',
  'canceledJobCount',
  'failedJobCount',
  'sliceCount',
  'unitRunCount',
  'commitAttemptCount',
  'yieldCount',
  'totalSliceDurationMs',
] as const satisfies readonly (keyof CooperativeRenderJobSchedulerStats)[];

const MAX_STATS = [
  'maxSliceDurationMs',
  'maxUnitDurationMs',
  'maxCommitDurationMs',
] as const satisfies readonly (keyof CooperativeRenderJobSchedulerStats)[];

function emptySchedulingStats(): CooperativeRenderJobSchedulerStats {
  return {
    submittedJobCount: 0,
    committedJobCount: 0,
    canceledJobCount: 0,
    failedJobCount: 0,
    sliceCount: 0,
    unitRunCount: 0,
    commitAttemptCount: 0,
    yieldCount: 0,
    totalSliceDurationMs: 0,
    maxSliceDurationMs: 0,
    maxUnitDurationMs: 0,
    maxCommitDurationMs: 0,
  };
}

function combineSchedulingStats(
  current: CooperativeRenderJobSchedulerStats,
  attempt: CooperativeRenderJobSchedulerStats,
): CooperativeRenderJobSchedulerStats {
  const combined = { ...current };
  for (const key of COUNT_STATS) combined[key] += attempt[key];
  for (const key of MAX_STATS) combined[key] = Math.max(combined[key], attempt[key]);
  return combined;
}

function logicalSettlement(
  settlement: CooperativeRenderJobSettlement,
  generation: number,
): CooperativeRenderJobSettlement {
  return settlement.status === 'failed'
    ? { ...settlement, generation }
    : { generation, status: settlement.status };
}

export interface SubmitResumableGeographicFeatureProjectionOptions {
  readonly scheduler: CooperativeRenderJobScheduler;
  readonly plan: ReadyProjectionPlan;
  /** The only callback authorized to replace the previous live scene. */
  commit(
    features: SystemFeatures,
    context: CooperativeRenderCommitContext,
  ): ResumableGeographicFeatureProjectionContinuation | null;
  /** Generation-local facts can be passed directly to RendererStats'
   * structurally compatible `recordScheduling` method. */
  recordScheduling?(stats: CooperativeRenderJobSchedulerStats): void;
  /** Receives only the physical projection attempt whose complete scene and
   * final live continuation committed. Refined and canceled drafts vanish. */
  recordAcceptedCounts?(counts: SourceFeatureProjectionCounts): void;
}

interface AggregationAttempt {
  readonly plan: ReadyProjectionPlan;
  readonly parts: readonly SystemFeatures[];
  readonly counts: SourceFeatureProjectionCounts;
  readonly batchSize: number;
  readonly tolerateBudgetOverrun: boolean;
}

class ResumableProjectionPipeline {
  private readonly ownership = {};
  private logicalGeneration = 0;
  private currentAttempt: CooperativeRenderJobHandle | null = null;
  private finalContinuation: ResumableGeographicFeatureProjectionContinuation | null = null;
  private acceptedCounts: SourceFeatureProjectionCounts | null = null;
  private readonly toleratedProjectionUnitIds = new Set<string>();
  private minimalAggregationAttemptUsed = false;
  private combinedStats = emptySchedulingStats();
  private finished = false;
  private resolveSettlement: (settlement: CooperativeRenderJobSettlement) => void = () => {};
  private resolveStats: (stats: CooperativeRenderJobSchedulerStats) => void = () => {};
  private readonly settled = new Promise<CooperativeRenderJobSettlement>((resolve) => {
    this.resolveSettlement = resolve;
  });
  private readonly stats = new Promise<CooperativeRenderJobSchedulerStats>((resolve) => {
    this.resolveStats = resolve;
  });

  constructor(private readonly options: SubmitResumableGeographicFeatureProjectionOptions) {
    latestSubmissionByScheduler.set(options.scheduler, this.ownership);
  }

  start(): ResumableGeographicFeatureProjectionHandle {
    this.scheduleAttempt(this.options.plan);
    return {
      generation: this.logicalGeneration,
      settled: this.settled,
      stats: this.stats,
      cancel: () => this.cancel(),
    };
  }

  private ownsGeneration(): boolean {
    return latestSubmissionByScheduler.get(this.options.scheduler) === this.ownership;
  }

  private finish(settlement: CooperativeRenderJobSettlement): void {
    if (this.finished) return;
    this.finished = true;
    if (this.ownsGeneration()) latestSubmissionByScheduler.delete(this.options.scheduler);
    if (settlement.status === 'committed' && this.acceptedCounts) {
      try {
        this.options.recordAcceptedCounts?.(this.acceptedCounts);
      } catch {
        // Diagnostics must not replace an already accepted renderer scene.
      }
    }
    this.resolveSettlement(logicalSettlement(settlement, this.logicalGeneration));
    this.resolveStats(this.combinedStats);
  }

  private recordAttempt(
    scheduled: CooperativeRenderJobHandle,
  ): Promise<CooperativeRenderJobSettlement> {
    return Promise.all([scheduled.settled, scheduled.stats]).then(([settlement, attemptStats]) => {
      this.combinedStats = combineSchedulingStats(this.combinedStats, attemptStats);
      try {
        this.options.recordScheduling?.(attemptStats);
      } catch {
        // Diagnostics must not strand renderer capture or presentation waits.
      }
      return settlement;
    });
  }

  private scheduleAggregation(attempt: AggregationAttempt): void {
    if (!this.ownsGeneration()) return;
    const aggregation = planResumableFeatureProjectionAggregation({
      units: attempt.plan.units,
      parts: attempt.parts,
      batchSize: attempt.batchSize,
      presentation: attempt.plan.presentation,
    });
    this.acceptedCounts = attempt.counts;
    const scheduled = this.options.scheduler.submit({
      units: aggregation.units,
      ...(attempt.tolerateBudgetOverrun ? { overBudgetUnitPolicy: 'yield' as const } : {}),
      commit: () => {
        this.finalContinuation =
          this.options.commit(aggregation.result(), { generation: this.logicalGeneration }) ?? null;
      },
    });
    this.currentAttempt = scheduled;
    void this.recordAttempt(scheduled).then((settlement) => {
      this.completeAggregation(attempt, settlement);
    });
  }

  private completeAggregation(
    attempt: AggregationAttempt,
    settlement: CooperativeRenderJobSettlement,
  ): void {
    if (!this.ownsGeneration()) {
      this.finish({ generation: this.logicalGeneration, status: 'canceled' });
      return;
    }
    if (this.retryAggregation(attempt, settlement)) return;
    if (settlement.status === 'committed' && this.finalContinuation) {
      this.waitForFinalContinuation(this.finalContinuation);
      return;
    }
    this.finish(settlement);
  }

  private retryAggregation(
    attempt: AggregationAttempt,
    settlement: CooperativeRenderJobSettlement,
  ): boolean {
    if (
      settlement.status !== 'failed' ||
      !(settlement.error instanceof CooperativeRenderUnitBudgetError)
    ) {
      return false;
    }
    if (attempt.batchSize > 1) {
      this.scheduleAggregation({
        ...attempt,
        batchSize: Math.max(1, Math.floor(attempt.batchSize / 2)),
      });
      return true;
    }
    if (!attempt.tolerateBudgetOverrun && !this.minimalAggregationAttemptUsed) {
      this.minimalAggregationAttemptUsed = true;
      this.scheduleAggregation({ ...attempt, tolerateBudgetOverrun: true });
      return true;
    }
    return false;
  }

  private waitForFinalContinuation(
    continuation: ResumableGeographicFeatureProjectionContinuation,
  ): void {
    void continuation.settled.then(
      () => {
        const status = this.ownsGeneration() ? 'committed' : 'canceled';
        this.finish({ generation: this.logicalGeneration, status });
      },
      (error: unknown) => {
        if (this.ownsGeneration()) {
          this.finish({
            generation: this.logicalGeneration,
            status: 'failed',
            error: toError(error),
          });
        } else {
          this.finish({ generation: this.logicalGeneration, status: 'canceled' });
        }
      },
    );
  }

  private scheduleAttempt(plan: ReadyProjectionPlan): void {
    const counts = createSourceFeatureProjectionCounts();
    const scheduled = this.options.scheduler.submit<SystemFeatures>({
      units: {
        unitAt(index) {
          const unit = plan.units.at(index);
          if (!unit) return undefined;
          return { id: unit.id, run: () => unit.run(counts) };
        },
      },
      ...(this.toleratedProjectionUnitIds.size > 0
        ? {
            overBudgetUnitPolicy: 'yield' as const,
            overBudgetYieldUnitIds: new Set(this.toleratedProjectionUnitIds),
          }
        : {}),
      commit: (parts) =>
        this.scheduleAggregation({
          plan,
          parts,
          counts,
          batchSize: 64,
          tolerateBudgetOverrun: false,
        }),
    });
    this.currentAttempt = scheduled;
    if (this.logicalGeneration === 0) this.logicalGeneration = scheduled.generation;
    void this.recordAttempt(scheduled).then((settlement) => {
      this.completeAttempt(plan, settlement);
    });
  }

  private completeAttempt(
    plan: ReadyProjectionPlan,
    settlement: CooperativeRenderJobSettlement,
  ): void {
    if (!this.ownsGeneration()) {
      this.finish({ generation: this.logicalGeneration, status: 'canceled' });
      return;
    }
    if (
      settlement.status === 'failed' &&
      settlement.error instanceof CooperativeRenderUnitBudgetError
    ) {
      const refined = plan.refineAfterUnitBudgetExceeded?.(settlement.error.unitId) ?? null;
      if (refined && refined !== plan) {
        // Planning IDs contain sequence positions. Re-prove every tolerated
        // singleton after refinement so a shifted batch cannot inherit an
        // unrelated unit's elapsed-time exception.
        this.toleratedProjectionUnitIds.clear();
        this.scheduleAttempt(refined);
        return;
      }
      if (!this.toleratedProjectionUnitIds.has(settlement.error.unitId)) {
        this.toleratedProjectionUnitIds.add(settlement.error.unitId);
        this.scheduleAttempt(plan);
        return;
      }
    }
    // A committed projection synchronously scheduled aggregation from its
    // private commit callback. That successor owns settlement now.
    if (settlement.status !== 'committed') this.finish(settlement);
  }

  private cancel(): boolean {
    if (this.finished) return false;
    if (this.ownsGeneration()) latestSubmissionByScheduler.delete(this.options.scheduler);
    if (this.finalContinuation) {
      this.finalContinuation.cancel();
      this.finish({ generation: this.logicalGeneration, status: 'canceled' });
      return true;
    }
    const currentAttempt = this.currentAttempt;
    if (currentAttempt) this.options.scheduler.cancel(currentAttempt.generation);
    return true;
  }
}

/** Stage projection and aggregation privately, then retain the same logical
 * settlement/cancellation lease through an optional live-scene continuation. */
export function submitResumableGeographicFeatureProjection(
  options: SubmitResumableGeographicFeatureProjectionOptions,
): ResumableGeographicFeatureProjectionHandle {
  return new ResumableProjectionPipeline(options).start();
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
