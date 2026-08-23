import { describe, expect, it, vi } from 'vitest';
import { createCooperativeRenderJobScheduler } from '../../src/map/cooperative-render-job-scheduler';
import { publishSceneDraft } from '../../src/map/scene-publication';
import {
  flushScenePublication,
  preparedSceneDraft as prepared,
  scenePublicationInput as input,
  ScenePublicationFrameClock,
} from '../support/scene-publication.test';

describe('scene publication continuity', () => {
  it('keeps one draft plan after a completed singleton overrun', async () => {
    const clock = new ScenePublicationFrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const publishDraftSynchronously = vi.fn();
    const recordScheduling = vi.fn();
    const batchSizes: number[] = [];
    const controller = {
      draft: (_input: typeof input, options?: { batchSize?: number }) => {
        batchSizes.push(options?.batchSize ?? 0);
        return {
          units: {
            unitAt: (index: number) =>
              index === 0
                ? {
                    id: 'persistent-singleton',
                    run: () => {
                      clock.nowMs += 3;
                    },
                  }
                : undefined,
          },
          result: () => prepared,
        };
      },
      publishDraftSynchronously,
    };
    const handle = publishSceneDraft({
      scheduler,
      controller,
      input,
      batchSize: 8,
      recordScheduling,
    });

    await flushScenePublication(clock, handle.settled);

    await expect(handle.settled).resolves.toBeUndefined();
    expect(batchSizes).toEqual([8]);
    expect(recordScheduling).toHaveBeenCalledOnce();
    expect(recordScheduling).toHaveBeenLastCalledWith(
      expect.objectContaining({
        committedJobCount: 1,
        failedJobCount: 0,
        maxUnitDurationMs: 3,
      }),
    );
    expect(publishDraftSynchronously).toHaveBeenCalledOnce();
  });
});
