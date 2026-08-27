import { describe, expect, it, vi } from 'vitest';
import {
  createCooperativeRenderJobScheduler,
  type CooperativeRenderJobSchedulerStats,
} from '../src/projection/cooperative-render-job-scheduler';
import { publishSceneDraft } from '../src/scene-publication';
import {
  flushScenePublication as flushUntilSettled,
  preparedSceneDraft as prepared,
  scenePublicationInput as input,
  ScenePublicationFrameClock as FrameClock,
} from './support/scene-publication.test';

describe('scene publication', () => {
  it('keeps planning, lazy work, and source commit behind one settlement barrier', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const unitAt = vi.fn((index: number) =>
      index === 0 ? { id: 'normalize', run: vi.fn() } : undefined,
    );
    const result = vi.fn(() => prepared);
    const update = { sourceUploadCount: 1 };
    const controller = {
      draft: vi.fn(() => ({ units: { unitAt }, result })),
      publishDraftSynchronously: vi.fn(() => update),
    };
    const onCommitted = vi.fn();

    const handle = publishSceneDraft({
      scheduler,
      controller,
      input,
      onCommitted,
    });

    expect(controller.draft).not.toHaveBeenCalled();
    expect(unitAt).not.toHaveBeenCalled();
    expect(result).not.toHaveBeenCalled();
    clock.flush();
    clock.flush();
    await expect(handle.settled).resolves.toBeUndefined();
    expect(controller.draft).toHaveBeenCalledWith(input, { batchSize: 4 });
    expect(result).toHaveBeenCalledOnce();
    expect(controller.publishDraftSynchronously).toHaveBeenCalledWith(prepared);
    expect(onCommitted).toHaveBeenCalledWith(update);
  });

  it('holds one paint gate across independently staged source units', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const events: string[] = [];
    const update = { sourceUploadCount: 2 };
    const sourceCommit = {
      sourceIds: ['stations', 'hit-features'],
      units: [
        {
          id: 'render-source:full:stations',
          sliceExclusive: true as const,
          run: () => {
            events.push('stations');
            clock.nowMs += 1;
          },
        },
        {
          id: 'render-source:full:hit-features',
          sliceExclusive: true as const,
          run: () => {
            events.push('hits');
            clock.nowMs += 1;
          },
        },
      ],
      commit: vi.fn(() => {
        events.push('publish');
        return update;
      }),
      abort: vi.fn(),
      mutationStarted: () => events.length > 0,
    };
    const controller = {
      draft: () => ({ units: { unitAt: () => undefined }, result: () => prepared }),
      preparePublication: vi.fn(() => sourceCommit),
      publishDraftSynchronously: vi.fn(),
    };
    const onSourceMutationStart = vi.fn(() => events.push('paint-gate'));
    const handle = publishSceneDraft({
      scheduler,
      controller,
      input,
      onSourceMutationStart,
    });

    clock.flush();
    expect(events).toEqual(['paint-gate', 'stations']);
    expect(onSourceMutationStart).toHaveBeenCalledWith(
      ['stations', 'hit-features'],
      expect.objectContaining({ sourceIds: ['stations', 'hit-features'] }),
    );
    expect(sourceCommit.commit).not.toHaveBeenCalled();
    clock.flush();
    expect(events).toEqual(['paint-gate', 'stations', 'hits']);
    expect(onSourceMutationStart).toHaveBeenCalledOnce();
    await flushUntilSettled(clock, handle.settled);
    await expect(handle.settled).resolves.toBeUndefined();
    expect(events).toEqual(['paint-gate', 'stations', 'hits', 'publish']);
    expect(controller.publishDraftSynchronously).not.toHaveBeenCalled();
  });

  it('publishes after an over-budget MapLibre mutation instead of rejecting completed work', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const batchSizes: number[] = [];
    let mutationStarted = false;
    const sourceCommit = {
      sourceIds: ['ways--bank-b'],
      units: [
        {
          id: 'render-source:atomic:patch',
          sliceExclusive: true as const,
          run: () => {
            mutationStarted = true;
            clock.nowMs += 5;
          },
        },
      ],
      stage: vi.fn(),
      publish: vi.fn(),
      commit: vi.fn(),
      abort: vi.fn(),
      mutationStarted: () => mutationStarted,
    };
    const handle = publishSceneDraft({
      scheduler,
      controller: {
        draft: (_input, options) => {
          batchSizes.push(options?.batchSize ?? 0);
          return { units: { unitAt: () => undefined }, result: () => prepared };
        },
        preparePublication: () => sourceCommit,
        publishDraftSynchronously: vi.fn(),
      },
      input,
    });

    await flushUntilSettled(clock, handle.settled);

    await expect(handle.settled).resolves.toBeUndefined();
    expect(batchSizes).toEqual([4]);
    expect(sourceCommit.abort).not.toHaveBeenCalled();
    expect(sourceCommit.stage).toHaveBeenCalledOnce();
    expect(sourceCommit.publish).toHaveBeenCalledOnce();
  });

  it('requests recovery synchronously before rejecting a source commit failure', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const failure = new Error('source commit failed');
    const events: string[] = [];
    const controller = {
      draft: () => ({ units: { unitAt: () => undefined }, result: () => prepared }),
      publishDraftSynchronously: () => {
        events.push('commit');
        throw failure;
      },
    };
    const handle = publishSceneDraft({
      scheduler,
      controller,
      input,
      onCommitError: (error) => events.push(error === failure ? 'recover' : 'wrong-error'),
    });

    clock.flush();
    clock.flush();
    await expect(handle.settled).rejects.toBe(failure);
    expect(events).toEqual(['commit', 'recover']);
  });

  it('can cancel a continued over-budget draft without restarting it', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const batchSizes: number[] = [];
    const controller = {
      draft: (_input: typeof input, options?: { batchSize?: number }) => {
        const batchSize = options?.batchSize ?? 64;
        batchSizes.push(batchSize);
        return {
          units: {
            unitAt: (index: number) =>
              index < 3
                ? {
                    id: `normalize:${index}`,
                    run: () => {
                      clock.nowMs += batchSize === 4 ? 3 : 1;
                    },
                  }
                : undefined,
          },
          result: () => prepared,
        };
      },
      publishDraftSynchronously: vi.fn(),
    };
    const handle = publishSceneDraft({
      scheduler,
      controller,
      input,
      batchSize: 4,
    });

    clock.flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(batchSizes).toEqual([4]);
    clock.flush();
    expect(batchSizes).toEqual([4]);
    expect(handle.cancel()).toBe(true);
    await expect(handle.settled).resolves.toBeUndefined();
    expect(controller.publishDraftSynchronously).not.toHaveBeenCalled();
  });

  it('commits a completed private overrun without restarting its plan', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const batchSizes: number[] = [];
    let attempt = 0;
    const publishDraftSynchronously = vi.fn();
    const handle = publishSceneDraft({
      scheduler,
      controller: {
        draft: (_input, options) => {
          batchSizes.push(options?.batchSize ?? 0);
          attempt += 1;
          return {
            units: {
              unitAt: (index: number) =>
                index === 0
                  ? {
                      id: `same-size:${attempt}`,
                      run: () => {
                        clock.nowMs += attempt === 1 ? 3 : 1;
                      },
                    }
                  : undefined,
            },
            result: () => prepared,
          };
        },
        publishDraftSynchronously,
      },
      input,
      batchSize: 4,
    });

    await flushUntilSettled(clock, handle.settled);

    await expect(handle.settled).resolves.toBeUndefined();
    expect(batchSizes).toEqual([4]);
    expect(publishDraftSynchronously).toHaveBeenCalledOnce();
  });

  it('records one scheduling attempt for a completed singleton overrun', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const batchSizes: number[] = [];
    const recordScheduling = vi.fn();
    const runSingleton = vi.fn();
    let attempt = 0;
    const publishDraftSynchronously = vi.fn();
    const handle = publishSceneDraft({
      scheduler,
      controller: {
        draft: (_input, options) => {
          batchSizes.push(options?.batchSize ?? 0);
          attempt += 1;
          return {
            units: {
              unitAt: (index: number) =>
                index === 0
                  ? {
                      id: `singleton:${attempt}`,
                      run: () => {
                        runSingleton();
                        clock.nowMs += attempt === 1 ? 3 : 1;
                      },
                    }
                  : undefined,
            },
            result: () => prepared,
          };
        },
        publishDraftSynchronously,
      },
      input,
      batchSize: 1,
      recordScheduling,
    });

    clock.flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    clock.flush();
    clock.flush();
    await expect(handle.settled).resolves.toBeUndefined();
    expect(batchSizes).toEqual([1]);
    expect(recordScheduling).toHaveBeenCalledOnce();
    expect(recordScheduling).toHaveBeenCalledWith(
      expect.objectContaining({
        committedJobCount: 1,
        failedJobCount: 0,
        maxUnitDurationMs: 3,
      }),
    );
    const [scheduling] = recordScheduling.mock.calls[0] as [CooperativeRenderJobSchedulerStats];
    expect(scheduling.yieldCount).toBeGreaterThan(0);
    expect(runSingleton).toHaveBeenCalledOnce();
    expect(publishDraftSynchronously).toHaveBeenCalledOnce();
  });
});
