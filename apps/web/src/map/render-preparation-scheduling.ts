import type {
  RenderPreparationCommitResult,
  RenderPreparationCoordinator,
  RenderPreparationPlan,
  RenderPreparationUnit,
  RenderPreparedSnapshot,
} from '@transitmapper/core/render/render-preparation';
import {
  CooperativeRenderUnitBudgetError,
  type CooperativeRenderJobHandle,
  type CooperativeRenderJobScheduler,
  type CooperativeRenderJobSchedulerStats,
  type CooperativeRenderJobSettlement,
  type CooperativeRenderJobUnitSequence,
} from './cooperative-render-job-scheduler';
import type { GeographicFeatureProjectionPreparationStats } from './resumable-feature-projection';

interface RenderPipelineContinuation {
  readonly generation: number | null;
  readonly settled: Promise<void>;
  cancel(): boolean;
}

export interface SubmitRenderPreparationPipelineOptions {
  readonly scheduler: CooperativeRenderJobScheduler;
  readonly coordinator: RenderPreparationCoordinator;
  createPlan(entityChunkSize: number): RenderPreparationPlan;
  continueWith(snapshot: RenderPreparedSnapshot): RenderPipelineContinuation | null;
  now(): number;
  recordPreparation?(stats: GeographicFeatureProjectionPreparationStats): void;
  recordScheduling?(stats: CooperativeRenderJobSchedulerStats): void;
}

export interface RenderPreparationPipelineHandle extends RenderPipelineContinuation {
  readonly generation: number;
}

interface PreparationAttempt {
  readonly entityChunkSize: number;
  readonly tolerateBudgetOverrun: boolean;
  plan: RenderPreparationPlan | null;
  commitResult: RenderPreparationCommitResult | null;
  totalDurationMs: number;
  maxDurationMs: number;
}

interface SnapshotResolution {
  readonly snapshot?: RenderPreparedSnapshot;
  readonly error?: Error;
}

const latestPipelineByScheduler = new WeakMap<CooperativeRenderJobScheduler, object>();

function preparationError(result: Exclude<RenderPreparationCommitResult, { kind: 'committed' }>) {
  switch (result.kind) {
    case 'budget-exceeded':
      return new Error(
        `Renderer preparation unit ${result.unitId} took ${result.measuredMs.toFixed(2)} ms.`,
      );
    case 'incomplete':
      return new Error(
        `Renderer preparation completed ${result.completedUnits} of ${result.unitCount} units.`,
      );
    case 'stale':
      return new Error(`Renderer preparation generation ${result.generation} became stale.`);
  }
}

function preparationUnitAt(
  plan: RenderPreparationPlan,
  index: number,
): RenderPreparationUnit | undefined {
  return plan.units.unitAt?.(index) ?? plan.units[index];
}

function measure<Result>(
  options: SubmitRenderPreparationPipelineOptions,
  attempt: PreparationAttempt,
  run: () => Result,
): Result {
  const startedAt = options.now();
  const result = run();
  const durationMs = options.now() - startedAt;
  attempt.totalDurationMs += durationMs;
  attempt.maxDurationMs = Math.max(attempt.maxDurationMs, durationMs);
  return result;
}

function preparationUnits(
  options: SubmitRenderPreparationPipelineOptions,
  attempt: PreparationAttempt,
): CooperativeRenderJobUnitSequence<unknown> {
  return {
    unitAt(index) {
      if (index === 0) {
        return {
          id: `prepare:plan:${attempt.entityChunkSize}`,
          run: () =>
            measure(
              options,
              attempt,
              () => (attempt.plan = options.createPlan(attempt.entityChunkSize)),
            ),
        };
      }
      if (!attempt.plan) return undefined;
      const plan = attempt.plan;
      const unit = preparationUnitAt(plan, index - 1);
      if (!unit) return undefined;
      return {
        id: unit.id,
        run() {
          const startedAt = options.now();
          const result = unit.run();
          const durationMs = options.now() - startedAt;
          attempt.totalDurationMs += durationMs;
          attempt.maxDurationMs = Math.max(attempt.maxDurationMs, durationMs);
          const measurement = { unitId: unit.id, result, durationMs };
          if (attempt.tolerateBudgetOverrun) {
            options.coordinator.record(plan, measurement, { tolerateBudgetOverrun: true });
          } else {
            options.coordinator.record(plan, measurement);
          }
          return result;
        },
      };
    },
  };
}

function recordAttempt(
  options: SubmitRenderPreparationPipelineOptions,
  attempt: PreparationAttempt,
  stats: CooperativeRenderJobSchedulerStats,
): void {
  try {
    options.recordScheduling?.(stats);
  } catch {
    // Diagnostics must not strand an otherwise complete renderer generation.
  }
  try {
    options.recordPreparation?.({
      preparationCount: 1,
      preparationDurationMs: attempt.totalDurationMs,
      maxPreparationDurationMs: attempt.maxDurationMs,
      overBudgetPreparationCount: attempt.maxDurationMs > 4 ? 1 : 0,
      includedInScheduling: true,
    });
  } catch {
    // Diagnostics must not strand an otherwise complete renderer generation.
  }
}

function retryable(
  attempt: PreparationAttempt,
  settlement: CooperativeRenderJobSettlement,
): boolean {
  return (
    (settlement.status === 'failed' &&
      settlement.error instanceof CooperativeRenderUnitBudgetError) ||
    attempt.commitResult?.kind === 'budget-exceeded'
  );
}

function resolveSnapshot(
  attempt: PreparationAttempt,
  settlement: CooperativeRenderJobSettlement,
): SnapshotResolution {
  if (settlement.status === 'failed') return { error: settlement.error };
  const result = attempt.commitResult;
  if (!result) return { error: new Error('Preparation did not commit.') };
  return result.kind === 'committed'
    ? { snapshot: result.snapshot }
    : { error: preparationError(result) };
}

class RenderPreparationPipeline {
  private readonly ownership = {};
  private logicalGeneration = 0;
  private currentJob: CooperativeRenderJobHandle | null = null;
  private continuation: RenderPipelineContinuation | null = null;
  private finished = false;
  private resolveSettlement: () => void = () => {};
  private rejectSettlement: (error: unknown) => void = () => {};
  private readonly settled = new Promise<void>((resolve, reject) => {
    this.resolveSettlement = resolve;
    this.rejectSettlement = reject;
  });

  constructor(private readonly options: SubmitRenderPreparationPipelineOptions) {
    latestPipelineByScheduler.set(options.scheduler, this.ownership);
  }

  start(): RenderPreparationPipelineHandle {
    this.scheduleAttempt(4);
    return {
      generation: this.logicalGeneration,
      settled: this.settled,
      cancel: () => this.cancel(),
    };
  }

  private ownsGeneration(): boolean {
    return latestPipelineByScheduler.get(this.options.scheduler) === this.ownership;
  }

  private scheduleAttempt(entityChunkSize: number, tolerateBudgetOverrun = false): void {
    if (!this.ownsGeneration()) return;
    const attempt: PreparationAttempt = {
      entityChunkSize,
      tolerateBudgetOverrun,
      plan: null,
      commitResult: null,
      totalDurationMs: 0,
      maxDurationMs: 0,
    };
    const scheduled = this.options.scheduler.submit({
      units: preparationUnits(this.options, attempt),
      ...(tolerateBudgetOverrun ? { overBudgetUnitPolicy: 'yield' as const } : {}),
      retainResults: false,
      commit: () => this.commitAttempt(attempt),
    });
    this.currentJob = scheduled;
    if (this.logicalGeneration === 0) this.logicalGeneration = scheduled.generation;
    void Promise.all([scheduled.settled, scheduled.stats]).then(([settlement, stats]) => {
      this.completeAttempt(attempt, settlement, stats);
    });
  }

  private commitAttempt(attempt: PreparationAttempt): void {
    if (!attempt.plan) throw new Error('Renderer preparation plan was not created.');
    attempt.commitResult = this.options.coordinator.commit(attempt.plan);
  }

  private completeAttempt(
    attempt: PreparationAttempt,
    settlement: CooperativeRenderJobSettlement,
    stats: CooperativeRenderJobSchedulerStats,
  ): void {
    recordAttempt(this.options, attempt, stats);
    if (!this.ownsGeneration()) {
      this.finish();
      return;
    }
    if (retryable(attempt, settlement) && attempt.entityChunkSize > 1) {
      this.scheduleAttempt(Math.max(1, Math.floor(attempt.entityChunkSize / 2)));
      return;
    }
    if (retryable(attempt, settlement) && !attempt.tolerateBudgetOverrun) {
      this.scheduleAttempt(1, true);
      return;
    }
    const resolution = resolveSnapshot(attempt, settlement);
    if (!resolution.snapshot) {
      this.finish(resolution.error);
      return;
    }
    this.startContinuation(resolution.snapshot);
  }

  private startContinuation(snapshot: RenderPreparedSnapshot): void {
    try {
      this.continuation = this.options.continueWith(snapshot);
    } catch (error) {
      this.finish(error);
      return;
    }
    if (!this.continuation) {
      this.finish();
      return;
    }
    void this.continuation.settled.then(
      () => this.finish(),
      (error: unknown) => this.finish(error),
    );
  }

  private cancel(): boolean {
    if (this.finished) return false;
    if (this.ownsGeneration()) latestPipelineByScheduler.delete(this.options.scheduler);
    this.continuation?.cancel();
    const currentJob = this.currentJob;
    if (currentJob) this.options.scheduler.cancel(currentJob.generation);
    this.finish();
    return true;
  }

  private finish(error?: unknown): void {
    if (this.finished) return;
    this.finished = true;
    if (this.ownsGeneration()) latestPipelineByScheduler.delete(this.options.scheduler);
    if (error === undefined) this.resolveSettlement();
    else this.rejectSettlement(error);
  }
}

/** Runs core's transactionally prepared indexes inside the same generation
 * ownership as projection. Every plan retry is fresh; rejected drafts never
 * become visible to downstream geometry or the live scene. */
export function submitRenderPreparationPipeline(
  options: SubmitRenderPreparationPipelineOptions,
): RenderPreparationPipelineHandle {
  return new RenderPreparationPipeline(options).start();
}
