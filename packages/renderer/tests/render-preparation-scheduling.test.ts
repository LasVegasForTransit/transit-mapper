import { describe, expect, it, vi } from 'vitest';
import type {
  RenderPreparationCommitResult,
  RenderPreparationCoordinator,
  RenderPreparationPlan,
  RenderPreparedSnapshot,
} from '@transitmapper/core/render/render-preparation';
import { createCooperativeRenderJobScheduler } from '../src/cooperative-render-job-scheduler';
import { submitRenderPreparationPipeline } from '../src/render-preparation-scheduling';

class FrameClock {
  nowMs = 0;
  private nextHandle = 1;
  readonly frames = new Map<number, () => void>();
  now = () => this.nowMs;
  scheduleFrame = (callback: () => void) => {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  };
  cancelFrame = (handle: number) => this.frames.delete(handle);
  flush() {
    const entry = this.frames.entries().next();
    if (entry.done) throw new Error('No frame scheduled.');
    const [handle, callback] = entry.value;
    this.frames.delete(handle);
    callback();
  }
}

function plan(generation: number, run: () => void): RenderPreparationPlan {
  return {
    generation,
    kind: 'cold',
    plannedOperations: {
      domainEntityVisits: 0,
      dependencyEntityVisits: 0,
      viewportEntityBuilds: 0,
      viewportSegmentQueries: 0,
      overlayWrites: 0,
    },
    units: [
      {
        id: `prepare:${generation}`,
        stage: 'domain',
        label: 'test preparation',
        operationCount: 1,
        run: () => {
          run();
          return { kind: 'completed', generation, unitId: `prepare:${generation}` };
        },
      },
    ],
  };
}

describe('render preparation scheduling', () => {
  it('continues the original projection batch after a plan-only overrun', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    let nextGeneration = 0;
    const snapshot = { kind: 'render-prepared-snapshot' } as RenderPreparedSnapshot;
    const coordinator = {
      plan: vi.fn(),
      record: vi.fn(),
      commit: vi.fn((): RenderPreparationCommitResult => ({ kind: 'committed', snapshot })),
      current: vi.fn(() => null),
    } satisfies RenderPreparationCoordinator;
    const unitRuns = vi.fn();
    const chunkSizes: number[] = [];
    const createPlan = (chunkSize: number) => {
      chunkSizes.push(chunkSize);
      const generation = ++nextGeneration;
      if (generation === 1) clock.nowMs += 3;
      return plan(generation, unitRuns);
    };
    const continueWith = vi.fn(() => null);

    const handle = submitRenderPreparationPipeline({
      scheduler,
      coordinator,
      createPlan,
      continueWith,
      now: clock.now,
    });
    clock.flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    clock.flush();
    clock.flush();

    await expect(handle.settled).resolves.toBeUndefined();
    expect(chunkSizes).toEqual([4]);
    expect(unitRuns).toHaveBeenCalledOnce();
    expect(coordinator.record).toHaveBeenCalledOnce();
    expect(coordinator.commit).toHaveBeenCalledOnce();
    expect(continueWith).toHaveBeenCalledOnce();
  });

  it('records an overrun and yields without repeating completed preparation', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const snapshot = { kind: 'render-prepared-snapshot' } as RenderPreparedSnapshot;
    const coordinator = {
      plan: vi.fn(),
      record: vi.fn(),
      commit: vi.fn((): RenderPreparationCommitResult => ({ kind: 'committed', snapshot })),
      current: vi.fn(() => null),
    } satisfies RenderPreparationCoordinator;
    const unitRuns: string[] = [];
    const chunkSizes: number[] = [];
    const recordPreparation = vi.fn();
    const recordScheduling = vi.fn();
    const continueWith = vi.fn(() => null);

    const handle = submitRenderPreparationPipeline({
      scheduler,
      coordinator,
      createPlan: (chunkSize) => {
        chunkSizes.push(chunkSize);
        return {
          ...plan(1, () => {}),
          units: [
            {
              id: 'prepare:slow',
              stage: 'domain',
              label: 'slow preparation',
              operationCount: 4,
              run: () => {
                unitRuns.push('slow');
                clock.nowMs += 5;
                return { kind: 'completed', generation: 1, unitId: 'prepare:slow' };
              },
            },
            {
              id: 'prepare:next',
              stage: 'domain',
              label: 'next preparation',
              operationCount: 1,
              run: () => {
                unitRuns.push('next');
                return { kind: 'completed', generation: 1, unitId: 'prepare:next' };
              },
            },
          ],
        };
      },
      continueWith,
      now: clock.now,
      recordPreparation,
      recordScheduling,
    });

    clock.flush();
    expect(unitRuns).toEqual(['slow']);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    clock.flush();
    expect(unitRuns).toEqual(['slow', 'next']);
    for (let frame = 0; frame < 8 && clock.frames.size > 0; frame += 1) {
      clock.flush();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    await expect(handle.settled).resolves.toBeUndefined();
    expect(chunkSizes).toEqual([4]);
    expect(coordinator.record).toHaveBeenCalledTimes(2);
    expect(coordinator.record).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.objectContaining({ unitId: 'prepare:slow', durationMs: 5 }),
      { tolerateBudgetOverrun: true },
    );
    expect(recordPreparation).toHaveBeenCalledOnce();
    expect(recordPreparation).toHaveBeenCalledWith(
      expect.objectContaining({ preparationCount: 1, overBudgetPreparationCount: 1 }),
    );
    expect(recordScheduling).toHaveBeenCalledOnce();
    expect(recordScheduling).toHaveBeenCalledWith(expect.objectContaining({ yieldCount: 2 }));
    expect(coordinator.commit).toHaveBeenCalledOnce();
    expect(continueWith).toHaveBeenCalledWith(snapshot);
  });

  it('settles an accepted snapshot when diagnostic callbacks throw', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const snapshot = { kind: 'render-prepared-snapshot' } as RenderPreparedSnapshot;
    const coordinator = {
      plan: vi.fn(),
      record: vi.fn(),
      commit: vi.fn((): RenderPreparationCommitResult => ({ kind: 'committed', snapshot })),
      current: vi.fn(() => null),
    } satisfies RenderPreparationCoordinator;
    const diagnosticError = new Error('diagnostic boom');
    const handle = submitRenderPreparationPipeline({
      scheduler,
      coordinator,
      createPlan: () => plan(1, () => {}),
      continueWith: () => null,
      now: clock.now,
      recordScheduling: () => {
        throw diagnosticError;
      },
      recordPreparation: () => {
        throw diagnosticError;
      },
    });

    for (let frame = 0; frame < 8 && clock.frames.size > 0; frame += 1) {
      clock.flush();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    await expect(handle.settled).resolves.toBeUndefined();
    expect(coordinator.commit).toHaveBeenCalledOnce();
  });

  it('lets a newer document cancel preparation before the older snapshot can continue', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const snapshot = { kind: 'render-prepared-snapshot' } as RenderPreparedSnapshot;
    const coordinator = {
      plan: vi.fn(),
      record: vi.fn(),
      commit: vi.fn((): RenderPreparationCommitResult => ({ kind: 'committed', snapshot })),
      current: vi.fn(() => null),
    } satisfies RenderPreparationCoordinator;
    const staleContinuation = vi.fn(() => null);
    const newerContinuation = vi.fn(() => null);
    const stale = submitRenderPreparationPipeline({
      scheduler,
      coordinator,
      createPlan: () => plan(1, () => {}),
      continueWith: staleContinuation,
      now: clock.now,
    });

    clock.flush();
    const newer = submitRenderPreparationPipeline({
      scheduler,
      coordinator,
      createPlan: () => plan(2, () => {}),
      continueWith: newerContinuation,
      now: clock.now,
    });
    for (let frame = 0; frame < 8 && clock.frames.size > 0; frame += 1) {
      clock.flush();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    await expect(stale.settled).resolves.toBeUndefined();
    await expect(newer.settled).resolves.toBeUndefined();
    expect(staleContinuation).not.toHaveBeenCalled();
    expect(newerContinuation).toHaveBeenCalledWith(snapshot);
    expect(coordinator.commit).toHaveBeenCalledOnce();
  });

  it('does not continue a preparation unit that throws', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const failure = new Error('preparation failed');
    const coordinator = {
      plan: vi.fn(),
      record: vi.fn(),
      commit: vi.fn(),
      current: vi.fn(() => null),
    } satisfies RenderPreparationCoordinator;
    const continueWith = vi.fn(() => null);
    const handle = submitRenderPreparationPipeline({
      scheduler,
      coordinator,
      createPlan: () =>
        plan(1, () => {
          throw failure;
        }),
      continueWith,
      now: clock.now,
    });

    clock.flush();

    await expect(handle.settled).rejects.toBe(failure);
    expect(coordinator.commit).not.toHaveBeenCalled();
    expect(continueWith).not.toHaveBeenCalled();
  });
});
