import type {
  CooperativeRenderCommitContext,
  CooperativeRenderJob,
  CooperativeRenderJobHandle,
  CooperativeRenderJobScheduler,
  CooperativeRenderJobSchedulerOptions,
  CooperativeRenderJobSchedulerStats,
  CooperativeRenderJobSettlement,
  CooperativeRenderJobUnit,
  CooperativeRenderJobUnitSequence,
  CooperativeRenderJobUnits,
} from './cooperative-render-job-types';

export type * from './cooperative-render-job-types';

interface ScheduledRenderJob {
  readonly generation: number;
  readonly units: CooperativeRenderJobUnits<unknown>;
  readonly commit: (results: readonly unknown[], context: CooperativeRenderCommitContext) => void;
  readonly staged: unknown[];
  readonly retainResults: boolean;
  readonly overBudgetUnitPolicy: 'fail' | 'yield';
  readonly overBudgetYieldUnitIds: ReadonlySet<string> | null;
  readonly settle: (settlement: CooperativeRenderJobSettlement) => void;
  readonly stats: MutableSchedulerStats;
  readonly settleStats: (stats: CooperativeRenderJobSchedulerStats) => void;
  nextUnitIndex: number;
  pendingUnit: CooperativeRenderJobUnit<unknown> | null;
  unitsExhausted: boolean;
  frameHandle: number | null;
}

type SliceWorkResult = 'complete-after-work' | 'complete-without-work' | 'stopped';
type PendingUnitResult = 'ready' | 'exhausted' | 'stopped';

function unitAt<Result>(
  units: CooperativeRenderJobUnits<Result>,
  index: number,
): CooperativeRenderJobUnit<Result> | undefined {
  if (!Array.isArray(units)) {
    return (units as CooperativeRenderJobUnitSequence<Result>).unitAt(index);
  }
  return (units as readonly CooperativeRenderJobUnit<Result>[])[index];
}

function emptyStats(): CooperativeRenderJobSchedulerStats {
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

function requireBudget(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('The cooperative render budget must be a finite positive number.');
  }
  return value;
}

export class CooperativeRenderUnitBudgetError extends Error {
  readonly budgetMs: number;
  readonly durationMs: number;
  readonly generation: number;
  readonly unitId: string;
  readonly unitIndex: number;

  constructor(input: {
    budgetMs: number;
    durationMs: number;
    generation: number;
    unitId: string;
    unitIndex: number;
  }) {
    super(
      `Render unit "${input.unitId}" took ${input.durationMs.toFixed(2)} ms, exceeding the ${input.budgetMs.toFixed(2)} ms cooperative budget.`,
    );
    this.name = 'CooperativeRenderUnitBudgetError';
    this.budgetMs = input.budgetMs;
    this.durationMs = input.durationMs;
    this.generation = input.generation;
    this.unitId = input.unitId;
    this.unitIndex = input.unitIndex;
  }
}

type MutableSchedulerStats = {
  -readonly [
    Key in keyof CooperativeRenderJobSchedulerStats
  ]: CooperativeRenderJobSchedulerStats[Key];
};

class CooperativeRenderJobSchedulerImplementation implements CooperativeRenderJobScheduler {
  private readonly sliceBudgetMs: () => number;
  /** Half the slice is the largest legal indivisible unit. Once that reserve
   * has been consumed, yielding before another unit guarantees two legal
   * worst-case units cannot turn a 4 ms slice into an 8 ms frame. */
  private readonly unitBudgetMs: () => number;
  private readonly stats = emptyStats() as MutableSchedulerStats;
  private nextGeneration = 0;
  private active: ScheduledRenderJob | null = null;
  private disposed = false;

  constructor(private readonly options: CooperativeRenderJobSchedulerOptions) {
    // A slice costs a whole frame whether it spends 1 ms or 20, so wall time
    // tracks the slice count rather than the budget. A caller that knows
    // nothing is interactive yet — a cold start with nothing painted — can
    // raise the budget to reach the first paint in fewer frames.
    const budget = options.budgetMs ?? 4;
    const resolve = typeof budget === 'function' ? budget : () => budget;
    this.sliceBudgetMs = () => requireBudget(resolve());
    this.unitBudgetMs = () => this.sliceBudgetMs() / 2;
    // A fixed budget is wrong at construction or never; a resolved one cannot
    // be read yet, because a caller's budget may depend on state it assigns
    // after building the scheduler. That one is checked on first use.
    if (typeof budget === 'number') requireBudget(budget);
  }

  submit<Result>(job: CooperativeRenderJob<Result>): CooperativeRenderJobHandle {
    if (this.disposed) throw new Error('The cooperative render job scheduler is disposed.');
    this.cancelActive();
    const generation = ++this.nextGeneration;
    let settle: (settlement: CooperativeRenderJobSettlement) => void = () => {};
    let settleStats: (stats: CooperativeRenderJobSchedulerStats) => void = () => {};
    const settled = new Promise<CooperativeRenderJobSettlement>((resolve) => {
      settle = resolve;
    });
    const stats = new Promise<CooperativeRenderJobSchedulerStats>((resolve) => {
      settleStats = resolve;
    });
    const jobStats = emptyStats() as MutableSchedulerStats;
    jobStats.submittedJobCount = 1;
    const scheduled: ScheduledRenderJob = {
      generation,
      // `readonly` is the ownership boundary. Retaining the sequence avoids an
      // eager O(unit count) copy in submit, which would hide planning work from
      // cooperative slice measurement.
      units: job.units,
      commit: (results, context) => job.commit(results as readonly Result[], context),
      staged: [],
      retainResults: job.retainResults !== false,
      overBudgetUnitPolicy: job.overBudgetUnitPolicy ?? 'fail',
      overBudgetYieldUnitIds: job.overBudgetYieldUnitIds ?? null,
      settle,
      stats: jobStats,
      settleStats,
      nextUnitIndex: 0,
      pendingUnit: null,
      unitsExhausted: Array.isArray(job.units) && job.units.length === 0,
      frameHandle: null,
    };
    this.active = scheduled;
    this.stats.submittedJobCount += 1;
    this.schedule(scheduled);
    return { generation, settled, stats };
  }

  cancel(generation: number): boolean {
    return this.cancelActive(generation);
  }

  snapshot(): CooperativeRenderJobSchedulerStats {
    return { ...this.stats };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelActive();
  }

  private finishSlice(job: ScheduledRenderJob, startedAt: number): void {
    const durationMs = this.options.now() - startedAt;
    this.stats.totalSliceDurationMs += durationMs;
    job.stats.totalSliceDurationMs += durationMs;
    this.stats.maxSliceDurationMs = Math.max(this.stats.maxSliceDurationMs, durationMs);
    job.stats.maxSliceDurationMs = Math.max(job.stats.maxSliceDurationMs, durationMs);
  }

  private cancelActive(generation?: number): boolean {
    const job = this.active;
    if (!job || (generation !== undefined && generation !== job.generation)) return false;
    this.active = null;
    if (job.frameHandle !== null) this.options.cancelFrame(job.frameHandle);
    job.frameHandle = null;
    job.staged.length = 0;
    this.stats.canceledJobCount += 1;
    job.stats.canceledJobCount += 1;
    job.settle({ generation: job.generation, status: 'canceled' });
    job.settleStats({ ...job.stats });
    return true;
  }

  private fail(job: ScheduledRenderJob, error: Error, sliceStartedAt: number): void {
    this.finishSlice(job, sliceStartedAt);
    job.staged.length = 0;
    if (this.active === job) this.active = null;
    this.stats.failedJobCount += 1;
    job.stats.failedJobCount += 1;
    job.settle({ generation: job.generation, status: 'failed', error });
    job.settleStats({ ...job.stats });
    try {
      this.options.onError?.(error, { generation: job.generation });
    } catch {
      // Diagnostics must not strand the deterministic settlement barrier.
    }
  }

  private schedule(job: ScheduledRenderJob): void {
    job.frameHandle = this.options.scheduleFrame(() => this.runSlice(job));
  }

  private runSlice(job: ScheduledRenderJob): void {
    job.frameHandle = null;
    if (this.active !== job) return;
    const sliceStartedAt = this.options.now();
    this.stats.sliceCount += 1;
    job.stats.sliceCount += 1;

    const result = this.runSliceWork(job, sliceStartedAt);
    if (result === 'stopped') return;
    if (result === 'complete-after-work') {
      this.yieldJob(job, sliceStartedAt);
      return;
    }
    this.commit(job, sliceStartedAt);
  }

  private runSliceWork(job: ScheduledRenderJob, sliceStartedAt: number): SliceWorkResult {
    let workPerformed = false;
    while (!job.unitsExhausted || job.pendingUnit) {
      if (workPerformed && this.unitReserveReached(sliceStartedAt)) {
        this.yieldJob(job, sliceStartedAt);
        return 'stopped';
      }
      const pending = this.ensurePendingUnit(job, sliceStartedAt);
      workPerformed = true;
      if (pending === 'stopped') return 'stopped';
      if (pending === 'exhausted') return 'complete-after-work';
      const unit = job.pendingUnit;
      if (!unit) throw new Error('Renderer work unit resolution lost its pending unit.');
      job.pendingUnit = null;
      if (!this.runUnit(job, unit, sliceStartedAt)) return 'stopped';
      if (unit.sliceExclusive) {
        this.yieldJob(job, sliceStartedAt);
        return 'stopped';
      }
    }
    return workPerformed ? 'complete-after-work' : 'complete-without-work';
  }

  private ensurePendingUnit(job: ScheduledRenderJob, sliceStartedAt: number): PendingUnitResult {
    if (job.pendingUnit) return 'ready';
    if (!this.resolveNextUnit(job, sliceStartedAt)) return 'stopped';
    if (job.unitsExhausted) return 'exhausted';
    if (this.unitReserveReached(sliceStartedAt)) {
      this.yieldJob(job, sliceStartedAt);
      return 'stopped';
    }
    return 'ready';
  }

  private unitReserveReached(sliceStartedAt: number): boolean {
    return this.options.now() - sliceStartedAt >= this.unitBudgetMs();
  }

  private yieldJob(job: ScheduledRenderJob, sliceStartedAt: number): void {
    this.finishSlice(job, sliceStartedAt);
    this.stats.yieldCount += 1;
    job.stats.yieldCount += 1;
    this.schedule(job);
  }

  /** Descriptor lookup is planning work, even for a lazy sequence. Resolve it
   * only while this slice still owns a complete indivisible-work reserve and
   * include its duration in the same ceiling as a unit body. */
  private resolveNextUnit(job: ScheduledRenderJob, sliceStartedAt: number): boolean {
    const descriptorStartedAt = this.options.now();
    let unit: CooperativeRenderJobUnit<unknown> | undefined;
    try {
      unit = unitAt(job.units, job.nextUnitIndex);
    } catch (thrown) {
      this.recordIndivisibleDuration(job, descriptorStartedAt);
      this.fail(job, toError(thrown), sliceStartedAt);
      return false;
    }
    const durationMs = this.recordIndivisibleDuration(job, descriptorStartedAt);
    if (this.active !== job) {
      this.finishSlice(job, sliceStartedAt);
      return false;
    }
    const unitId = unit?.id ?? `descriptor:${job.nextUnitIndex}:complete`;
    if (durationMs > this.unitBudgetMs() && !this.canYieldOverBudget(job, unitId)) {
      this.fail(job, this.unitBudgetError(job, unitId, durationMs), sliceStartedAt);
      return false;
    }
    if (unit) job.pendingUnit = unit;
    else job.unitsExhausted = true;
    if (durationMs > this.unitBudgetMs()) {
      this.yieldJob(job, sliceStartedAt);
      return false;
    }
    return true;
  }

  private runUnit(
    job: ScheduledRenderJob,
    unit: CooperativeRenderJobUnit<unknown>,
    sliceStartedAt: number,
  ): boolean {
    const unitStartedAt = this.options.now();
    let result: unknown;
    try {
      result = unit.run();
    } catch (thrown) {
      this.recordUnitDuration(job, unitStartedAt);
      this.fail(job, toError(thrown), sliceStartedAt);
      return false;
    }
    const unitDurationMs = this.recordUnitDuration(job, unitStartedAt);
    if (this.active !== job) {
      this.finishSlice(job, sliceStartedAt);
      return false;
    }
    const unitBudgetMs = unit.sliceExclusive ? this.sliceBudgetMs() : this.unitBudgetMs();
    if (unitDurationMs > unitBudgetMs && !this.canYieldOverBudget(job, unit.id)) {
      this.fail(
        job,
        this.unitBudgetError(job, unit.id, unitDurationMs, unitBudgetMs),
        sliceStartedAt,
      );
      return false;
    }
    job.nextUnitIndex += 1;
    if (
      Array.isArray(job.units) &&
      job.nextUnitIndex >= (job.units as readonly CooperativeRenderJobUnit<unknown>[]).length
    ) {
      job.unitsExhausted = true;
    }
    if (job.retainResults) job.staged.push(result);
    if (unitDurationMs > unitBudgetMs) {
      this.yieldJob(job, sliceStartedAt);
      return false;
    }
    return true;
  }

  private canYieldOverBudget(job: ScheduledRenderJob, unitId: string): boolean {
    return (
      job.overBudgetUnitPolicy === 'yield' &&
      (job.overBudgetYieldUnitIds === null || job.overBudgetYieldUnitIds.has(unitId))
    );
  }

  private recordUnitDuration(job: ScheduledRenderJob, unitStartedAt: number): number {
    const durationMs = this.recordIndivisibleDuration(job, unitStartedAt);
    this.stats.unitRunCount += 1;
    job.stats.unitRunCount += 1;
    return durationMs;
  }

  private recordIndivisibleDuration(job: ScheduledRenderJob, startedAt: number): number {
    const durationMs = this.options.now() - startedAt;
    this.stats.maxUnitDurationMs = Math.max(this.stats.maxUnitDurationMs, durationMs);
    job.stats.maxUnitDurationMs = Math.max(job.stats.maxUnitDurationMs, durationMs);
    return durationMs;
  }

  private unitBudgetError(
    job: ScheduledRenderJob,
    unitId: string,
    durationMs: number,
    budgetMs = this.unitBudgetMs(),
  ): CooperativeRenderUnitBudgetError {
    return new CooperativeRenderUnitBudgetError({
      budgetMs,
      durationMs,
      generation: job.generation,
      unitId,
      unitIndex: job.nextUnitIndex,
    });
  }

  private commit(job: ScheduledRenderJob, sliceStartedAt: number): void {
    const commitStartedAt = this.options.now();
    this.stats.commitAttemptCount += 1;
    job.stats.commitAttemptCount += 1;
    // Committing is the generation's terminal atomic boundary. Clear ownership
    // first so a synchronous store notification may enqueue its successor
    // without canceling this already-completed body of work.
    this.active = null;
    try {
      // The staged array is already job-private and becomes unreachable after
      // settlement. Passing it directly keeps this atomic boundary O(1)
      // instead of copying thousands of projection parts in one frame.
      job.commit(job.staged, { generation: job.generation });
    } catch (thrown) {
      this.recordCommitDuration(job, commitStartedAt);
      this.fail(job, toError(thrown), sliceStartedAt);
      return;
    }
    this.recordCommitDuration(job, commitStartedAt);
    this.finishSlice(job, sliceStartedAt);
    this.stats.committedJobCount += 1;
    job.stats.committedJobCount += 1;
    job.settle({ generation: job.generation, status: 'committed' });
    job.settleStats({ ...job.stats });
  }

  private recordCommitDuration(job: ScheduledRenderJob, commitStartedAt: number): void {
    const durationMs = this.options.now() - commitStartedAt;
    this.stats.maxCommitDurationMs = Math.max(this.stats.maxCommitDurationMs, durationMs);
    job.stats.maxCommitDurationMs = Math.max(job.stats.maxCommitDurationMs, durationMs);
  }
}

function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/** Runs non-urgent projection as bounded synchronous units. A replacement
 * generation cancels and releases any privately staged predecessor; only a
 * fully completed generation reaches its single commit callback. */
export function createCooperativeRenderJobScheduler(
  options: CooperativeRenderJobSchedulerOptions,
): CooperativeRenderJobScheduler {
  return new CooperativeRenderJobSchedulerImplementation(options);
}
