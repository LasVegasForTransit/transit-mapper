export interface CooperativeRenderJobUnit<Result> {
  /** Stable diagnostic label. A unit must not mutate the live renderer and must
   * remain small enough to complete within the scheduler's slice budget. */
  readonly id: string;
  /** A measured source/runtime boundary that cannot be split internally may
   * consume the full slice. The scheduler runs it alone and yields before
   * resolving any successor descriptor. */
  readonly sliceExclusive?: boolean;
  run(): Result;
}

export interface CooperativeRenderJobUnitSequence<Result> {
  /** Returns one stable unit for this index, or undefined after the sequence.
   * Descriptor lookup is measured as indivisible planning work and must fit
   * the same ceiling as a unit body. Rendering work belongs in the unit. */
  unitAt(index: number): CooperativeRenderJobUnit<Result> | undefined;
}

export type CooperativeRenderJobUnits<Result> =
  readonly CooperativeRenderJobUnit<Result>[] | CooperativeRenderJobUnitSequence<Result>;

export interface CooperativeRenderCommitContext {
  readonly generation: number;
}

export interface CooperativeRenderJob<Result> {
  readonly units: CooperativeRenderJobUnits<Result>;
  /** Elapsed time is a performance signal, not always a correctness signal.
   * Structurally minimal final attempts may retain completed private work and
   * yield immediately after an overrun instead of leaving the live scene
   * permanently stale because GC or JIT time was charged to one unit. */
  readonly overBudgetUnitPolicy?: 'fail' | 'yield';
  /** Narrows `yield` to units whose structural minimum was independently
   * proven. Omit only when every unit in this private attempt is minimal. */
  readonly overBudgetYieldUnitIds?: ReadonlySet<string>;
  /** Side-effect-only staging can discard unit return values instead of
   * retaining one object per unit until the atomic commit. */
  readonly retainResults?: boolean;
  /** The only live-state mutation in a job. It receives every privately staged
   * result once, after the complete generation has finished. */
  commit(results: readonly Result[], context: CooperativeRenderCommitContext): void;
}

export interface CooperativeRenderCommittedSettlement {
  readonly generation: number;
  readonly status: 'committed';
}

export interface CooperativeRenderCanceledSettlement {
  readonly generation: number;
  readonly status: 'canceled';
}

export interface CooperativeRenderFailedSettlement {
  readonly generation: number;
  readonly status: 'failed';
  readonly error: Error;
}

export type CooperativeRenderJobSettlement =
  | CooperativeRenderCommittedSettlement
  | CooperativeRenderCanceledSettlement
  | CooperativeRenderFailedSettlement;

export interface CooperativeRenderJobHandle {
  readonly generation: number;
  /** Deterministic barrier that always resolves, including cancel/failure. */
  readonly settled: Promise<CooperativeRenderJobSettlement>;
  /** Generation-local scheduling facts, resolved at the same terminal barrier.
   * Unlike subtracting global snapshots, maxima stay truthful when jobs overlap. */
  readonly stats: Promise<CooperativeRenderJobSchedulerStats>;
}

export interface CooperativeRenderJobSchedulerStats {
  readonly submittedJobCount: number;
  readonly committedJobCount: number;
  readonly canceledJobCount: number;
  readonly failedJobCount: number;
  readonly sliceCount: number;
  readonly unitRunCount: number;
  readonly commitAttemptCount: number;
  readonly yieldCount: number;
  /** Main-thread time spent inside this job's scheduler slices. Frame-queue
   * latency between slices is deliberately excluded. */
  readonly totalSliceDurationMs: number;
  readonly maxSliceDurationMs: number;
  readonly maxUnitDurationMs: number;
  readonly maxCommitDurationMs: number;
}

export interface CooperativeRenderJobSchedulerOptions {
  readonly budgetMs?: number;
  now(): number;
  /** Must defer the callback; requestAnimationFrame is the production adapter. */
  scheduleFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  onError?(error: Error, context: CooperativeRenderCommitContext): void;
}

export interface CooperativeRenderJobScheduler {
  submit<Result>(job: CooperativeRenderJob<Result>): CooperativeRenderJobHandle;
  cancel(generation: number): boolean;
  snapshot(): CooperativeRenderJobSchedulerStats;
  dispose(): void;
}
