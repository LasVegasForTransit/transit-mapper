import { describe, expect, it, vi } from 'vitest';
import { createCooperativeRenderJobScheduler } from '../../src/map/cooperative-render-job-scheduler';
import { publishSceneDraft } from '../../src/map/scene-publication';
import {
  flushScenePublication,
  preparedSceneDraft as prepared,
  scenePublicationInput as input,
  ScenePublicationFrameClock,
} from '../support/scene-publication.test';

/**
 * Source preparation calls into the renderer's own source machinery, so the
 * cooperative scheduler can neither divide it nor predict it. It measured 7 ms
 * against the 4 ms budget on an ordinary cold start, and because the unit was
 * not registered as over-budget-yieldable it failed the whole publication
 * every time: the bank transaction aborted, the map retried, and no system of
 * any size ever published a first scene.
 */
describe('scene publication source preparation', () => {
  it('publishes even when preparation runs over the cooperative budget', async () => {
    const clock = new ScenePublicationFrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const sourceCommit = {
      sourceIds: ['tm-ways--bank-a'],
      units: [{ id: 'hidden-source', sliceExclusive: true as const, run: () => {} }],
      mode: 'hidden' as const,
      bank: 'a' as const,
      stage: vi.fn(() => ({ sourceUploadCount: 1 })),
      markSourcesLoaded: vi.fn(),
      activate: vi.fn(),
      publish: vi.fn(() => ({ sourceUploadCount: 1 })),
      commit: vi.fn(),
      abort: vi.fn(),
      mutationStarted: () => true,
    };

    const handle = publishSceneDraft({
      scheduler,
      controller: {
        draft: () => ({ units: { unitAt: () => undefined }, result: () => prepared }),
        preparePublication: () => sourceCommit,
        publishDraftSynchronously: vi.fn(),
      },
      input,
      // The overrun the scheduler cannot avoid: one indivisible call that
      // costs nearly twice the slice budget.
      beforeSourceMutation: () => {
        clock.nowMs += 7;
      },
    });

    await flushScenePublication(clock, handle.settled);

    await expect(handle.settled).resolves.toBeUndefined();
    expect(sourceCommit.abort).not.toHaveBeenCalled();
    expect(sourceCommit.publish).toHaveBeenCalled();
  });
});
