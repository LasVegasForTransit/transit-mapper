import { describe, expect, it, vi } from 'vitest';
import type {
  RenderPreparationCommitResult,
  RenderPreparationCoordinator,
  RenderPreparationPlan,
  RenderPreparedSnapshot,
} from '@transitmapper/core/render/render-preparation';
import { createCooperativeRenderJobScheduler } from '../../src/map/cooperative-render-job-scheduler';
import { submitRenderPreparationPipeline } from '../../src/map/render-preparation-scheduling';

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
  it('does not authorize preparation units after synchronous plan creation exceeds the slice reserve', async () => {
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
    expect(chunkSizes).toEqual([4, 2]);
    expect(unitRuns).toHaveBeenCalledOnce();
    expect(coordinator.record).toHaveBeenCalledOnce();
    expect(coordinator.commit).toHaveBeenCalledOnce();
    expect(continueWith).toHaveBeenCalledOnce();
  });

  it('replans an oversized preparation batch before authorizing projection', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    let nextGeneration = 0;
    let currentPlan: RenderPreparationPlan | null = null;
    const snapshot = { kind: 'render-prepared-snapshot' } as RenderPreparedSnapshot;
    const coordinator = {
      plan: vi.fn(),
      record: vi.fn(),
      commit: vi.fn((candidate: RenderPreparationPlan): RenderPreparationCommitResult =>
        candidate.generation === 1
          ? {
              kind: 'budget-exceeded',
              unitId: 'prepare:1',
              limitMs: 4,
              measuredMs: 5,
              previous: null,
            }
          : { kind: 'committed', snapshot },
      ),
      current: vi.fn(() => null),
    } satisfies RenderPreparationCoordinator;
    const chunkSizes: number[] = [];
    const createPlan = (chunkSize: number) => {
      chunkSizes.push(chunkSize);
      const generation = ++nextGeneration;
      currentPlan = plan(generation, () => {
        clock.nowMs += generation === 1 ? 5 : 1;
      });
      return currentPlan;
    };
    const continueWith = vi.fn(() => ({
      generation: 99,
      settled: Promise.resolve(),
      cancel: () => true,
    }));

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
    expect(chunkSizes).toEqual([4, 2]);
    expect(continueWith).toHaveBeenCalledOnce();
    expect(coordinator.record).toHaveBeenCalledTimes(2);
  });

  it('keeps a structurally minimal prepared snapshot after reporting an elapsed-time overrun', async () => {
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
    const chunkSizes: number[] = [];
    const createPlan = (chunkSize: number) => {
      chunkSizes.push(chunkSize);
      const generation = ++nextGeneration;
      return plan(generation, () => {
        clock.nowMs += 3;
      });
    };
    const continueWith = vi.fn(() => null);
    const handle = submitRenderPreparationPipeline({
      scheduler,
      coordinator,
      createPlan,
      continueWith,
      now: clock.now,
    });

    for (let frame = 0; frame < 24 && clock.frames.size > 0; frame += 1) {
      clock.flush();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    await expect(handle.settled).resolves.toBeUndefined();
    expect(chunkSizes).toEqual([4, 2, 1, 1]);
    expect(coordinator.record).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ durationMs: 3 }),
      { tolerateBudgetOverrun: true },
    );
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
});
