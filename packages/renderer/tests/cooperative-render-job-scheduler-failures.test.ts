import { describe, expect, it, vi } from 'vitest';
import {
  CooperativeRenderUnitBudgetError,
  createCooperativeRenderJobScheduler,
} from '../src/cooperative-render-job-scheduler';

class FailureClock {
  nowMs = 0;
  private nextHandle = 1;
  readonly frames = new Map<number, () => void>();
  now = (): number => this.nowMs;
  scheduleFrame = (callback: () => void): number => {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  };
  cancelFrame = (handle: number): void => {
    this.frames.delete(handle);
  };
  advance(durationMs: number): void {
    this.nowMs += durationMs;
  }
  flushFrame(): void {
    const callback = this.frames.values().next().value;
    if (!callback) throw new Error('No frame is scheduled.');
    this.frames.clear();
    callback();
  }
}

describe('cooperative render job failures', () => {
  it('rejects and reports a unit that consumes the reserve for a following unit', async () => {
    const clock = new FailureClock();
    const commit = vi.fn();
    const onError = vi.fn();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
      onError,
    });
    const handle = scheduler.submit({
      units: [
        {
          id: 'monolithic-projection',
          run: () => {
            clock.advance(2.01);
            return 'must-not-commit';
          },
        },
      ],
      commit,
    });

    clock.flushFrame();

    expect(commit).not.toHaveBeenCalled();
    const settlement = await handle.settled;
    expect(settlement.status).toBe('failed');
    if (settlement.status !== 'failed') throw new Error('Expected the render job to fail.');
    expect(settlement.error).toBeInstanceOf(CooperativeRenderUnitBudgetError);
    expect(settlement.error).toMatchObject({
      budgetMs: 2,
      durationMs: 2.01,
      generation: handle.generation,
      unitId: 'monolithic-projection',
      unitIndex: 0,
    });
    expect(onError).toHaveBeenCalledWith(settlement.error, { generation: handle.generation });
    expect(scheduler.snapshot()).toMatchObject({
      failedJobCount: 1,
      committedJobCount: 0,
      unitRunCount: 1,
      maxSliceDurationMs: 2.01,
      maxUnitDurationMs: 2.01,
    });
  });

  it('reports a thrown unit and discards every staged result without committing', async () => {
    const clock = new FailureClock();
    const failure = new Error('projection failed');
    const commit = vi.fn();
    const onError = vi.fn();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
      onError,
    });
    const handle = scheduler.submit({
      units: [
        { id: 'staged', run: () => 'must-be-discarded' },
        {
          id: 'failure',
          run: () => {
            clock.advance(1);
            throw failure;
          },
        },
      ],
      commit,
    });

    expect(() => clock.flushFrame()).not.toThrow();
    expect(commit).not.toHaveBeenCalled();
    await expect(handle.settled).resolves.toEqual({
      generation: handle.generation,
      status: 'failed',
      error: failure,
    });
    expect(onError).toHaveBeenCalledWith(failure, { generation: handle.generation });
    expect(scheduler.snapshot()).toMatchObject({
      failedJobCount: 1,
      committedJobCount: 0,
      unitRunCount: 2,
      maxUnitDurationMs: 1,
      maxSliceDurationMs: 1,
    });
  });

  it('settles as failed when the single atomic commit reports an error', async () => {
    const clock = new FailureClock();
    const failure = new Error('source swap failed');
    const onError = vi.fn();
    const commit = vi.fn(() => {
      clock.advance(1);
      throw failure;
    });
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
      onError,
    });
    const handle = scheduler.submit({ units: [], commit });

    expect(() => clock.flushFrame()).not.toThrow();
    expect(commit).toHaveBeenCalledOnce();
    await expect(handle.settled).resolves.toEqual({
      generation: handle.generation,
      status: 'failed',
      error: failure,
    });
    expect(onError).toHaveBeenCalledWith(failure, { generation: handle.generation });
    expect(scheduler.snapshot()).toMatchObject({
      committedJobCount: 0,
      failedJobCount: 1,
      commitAttemptCount: 1,
      maxCommitDurationMs: 1,
      maxSliceDurationMs: 1,
    });
  });

  it('does not let a diagnostic reporter strand the settlement barrier', async () => {
    const clock = new FailureClock();
    const projectionFailure = new Error('projection failed');
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
      onError: () => {
        throw new Error('reporter failed');
      },
    });
    const handle = scheduler.submit({
      units: [
        {
          id: 'failure',
          run: () => {
            throw projectionFailure;
          },
        },
      ],
      commit: vi.fn(),
    });

    expect(() => clock.flushFrame()).not.toThrow();
    await expect(handle.settled).resolves.toEqual({
      generation: handle.generation,
      status: 'failed',
      error: projectionFailure,
    });
  });

  it('preserves a generation submitted synchronously by the completed commit', async () => {
    const clock = new FailureClock();
    const currentCommit = vi.fn();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    let currentHandle: ReturnType<typeof scheduler.submit<string>> | undefined;
    const first = scheduler.submit({
      units: [{ id: 'first', run: () => 'first-result' }],
      commit: () => {
        currentHandle = scheduler.submit({
          units: [{ id: 'current', run: () => 'current-result' }],
          commit: currentCommit,
        });
      },
    });

    clock.flushFrame();
    expect(currentHandle).toBeUndefined();
    clock.flushFrame();
    await expect(first.settled).resolves.toEqual({
      generation: first.generation,
      status: 'committed',
    });
    expect(clock.frames.size).toBe(1);
    clock.flushFrame();
    expect(currentCommit).not.toHaveBeenCalled();
    clock.flushFrame();

    if (!currentHandle) throw new Error('The first commit did not submit its successor.');
    await expect(currentHandle.settled).resolves.toEqual({
      generation: currentHandle.generation,
      status: 'committed',
    });
    expect(currentCommit).toHaveBeenCalledOnce();
    expect(scheduler.snapshot()).toMatchObject({
      submittedJobCount: 2,
      committedJobCount: 2,
      canceledJobCount: 0,
    });
  });

  it('cancels pending work on disposal and refuses later submissions', async () => {
    const clock = new FailureClock();
    const commit = vi.fn();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const handle = scheduler.submit({
      units: [{ id: 'pending', run: () => 'pending-result' }],
      commit,
    });

    scheduler.dispose();
    scheduler.dispose();

    await expect(handle.settled).resolves.toEqual({
      generation: handle.generation,
      status: 'canceled',
    });
    expect(clock.frames.size).toBe(0);
    expect(commit).not.toHaveBeenCalled();
    expect(scheduler.snapshot().canceledJobCount).toBe(1);
    expect(() => scheduler.submit({ units: [], commit })).toThrow('disposed');
  });

  it('runs the atomic commit on a fresh slice after unit work', async () => {
    const clock = new FailureClock();
    const commit = vi.fn(() => clock.advance(3.9));
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const handle = scheduler.submit({
      units: [
        {
          id: 'complete-scene',
          run: () => {
            clock.advance(1.9);
            return 'settled-scene';
          },
        },
      ],
      commit,
    });

    clock.flushFrame();
    expect(commit).not.toHaveBeenCalled();
    expect(scheduler.snapshot()).toMatchObject({
      sliceCount: 1,
      yieldCount: 1,
      maxSliceDurationMs: 1.9,
      maxUnitDurationMs: 1.9,
    });

    clock.flushFrame();
    expect(commit).toHaveBeenCalledOnce();
    await expect(handle.settled).resolves.toMatchObject({ status: 'committed' });
    expect(scheduler.snapshot()).toMatchObject({
      sliceCount: 2,
      yieldCount: 1,
      maxSliceDurationMs: 3.9,
      maxUnitDurationMs: 1.9,
      maxCommitDurationMs: 3.9,
    });
  });

  it('records and yields after a tolerated indivisible overrun without discarding work', async () => {
    const clock = new FailureClock();
    const commit = vi.fn();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const handle = scheduler.submit({
      units: [
        {
          id: 'structurally-minimal-feature',
          run: () => {
            clock.advance(5);
            return 'exact-feature';
          },
        },
      ],
      overBudgetUnitPolicy: 'yield',
      commit,
    });

    clock.flushFrame();
    expect(commit).not.toHaveBeenCalled();
    expect(scheduler.snapshot()).toMatchObject({
      failedJobCount: 0,
      maxUnitDurationMs: 5,
      maxSliceDurationMs: 5,
      yieldCount: 1,
    });
    clock.flushFrame();

    await expect(handle.settled).resolves.toMatchObject({ status: 'committed' });
    expect(commit).toHaveBeenCalledWith(['exact-feature'], {
      generation: handle.generation,
    });
  });
});
