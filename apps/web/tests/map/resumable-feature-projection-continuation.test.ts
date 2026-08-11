import { describe, expect, it, vi } from 'vitest';
import { createCooperativeRenderJobScheduler } from '../../src/map/cooperative-render-job-scheduler';
import { submitResumableGeographicFeatureProjection } from '../../src/map/resumable-feature-projection-scheduling';
import type { SceneDraft } from '../../src/map/scene-draft';
import { publishSceneDraft } from '../../src/map/scene-publication';
import { emptySystemFeatures } from '../../src/map/system-feature-sources';

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
  cancelFrame = (handle: number) => {
    this.frames.delete(handle);
  };
  flushFrame(): void {
    const entry = this.frames.entries().next();
    if (entry.done) throw new Error('No frame is scheduled.');
    const [handle, callback] = entry.value;
    this.frames.delete(handle);
    callback();
  }
}

async function flushPipeline(clock: FrameClock): Promise<void> {
  for (let index = 0; index < 12; index++) {
    await Promise.resolve();
    await Promise.resolve();
    if (clock.frames.size === 0) return;
    clock.flushFrame();
  }
  throw new Error('Render pipeline did not settle within twelve frames.');
}

describe('resumable projection final continuation', () => {
  it('keeps settlement and cancellation ownership through a delayed final scene stage', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    let resolveFinalStage = () => {};
    const finalStageSettled = new Promise<void>((resolve) => {
      resolveFinalStage = resolve;
    });
    const cancelFinalStage = vi.fn(() => true);
    const handle = submitResumableGeographicFeatureProjection({
      scheduler,
      plan: { kind: 'ready', sourceIds: [], units: [], aggregate: emptySystemFeatures },
      commit: () => ({ settled: finalStageSettled, cancel: cancelFinalStage }),
    });
    await flushPipeline(clock);
    let settled = false;
    void handle.settled.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(handle.cancel()).toBe(true);
    expect(cancelFinalStage).toHaveBeenCalledOnce();
    await expect(handle.settled).resolves.toEqual({
      generation: handle.generation,
      status: 'canceled',
    });
    resolveFinalStage();
  });

  it('settles a rejected final stage as canceled after a newer submission takes ownership', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    let rejectFinalStage: (error: Error) => void = () => {};
    const finalStageSettled = new Promise<void>((_resolve, reject) => {
      rejectFinalStage = reject;
    });
    const stale = submitResumableGeographicFeatureProjection({
      scheduler,
      plan: { kind: 'ready', sourceIds: [], units: [], aggregate: emptySystemFeatures },
      commit: () => ({ settled: finalStageSettled, cancel: () => true }),
    });
    await flushPipeline(clock);

    const current = submitResumableGeographicFeatureProjection({
      scheduler,
      plan: { kind: 'ready', sourceIds: [], units: [], aggregate: emptySystemFeatures },
      commit: () => null,
    });
    await flushPipeline(clock);
    rejectFinalStage(new Error('stale source submission rejected'));

    await expect(stale.settled).resolves.toMatchObject({ status: 'canceled' });
    await expect(current.settled).resolves.toMatchObject({ status: 'committed' });
  });

  it('does not settle the parent generation before the staged source transaction publishes', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const prepared = {} as SceneDraft;
    const publishDraftSynchronously = vi.fn();
    let finalStageSubmitted = false;
    const handle = submitResumableGeographicFeatureProjection({
      scheduler,
      plan: { kind: 'ready', sourceIds: [], units: [], aggregate: emptySystemFeatures },
      commit: () => {
        finalStageSubmitted = true;
        return publishSceneDraft({
          scheduler,
          controller: {
            draft: () => ({ units: { unitAt: () => undefined }, result: () => prepared }),
            publishDraftSynchronously,
          },
          input: { revision: 'final-scene', features: emptySystemFeatures(), sourceIds: [] },
        });
      },
    });
    let parentSettled = false;
    void handle.settled.then(() => {
      parentSettled = true;
    });

    for (let index = 0; index < 4; index += 1) {
      clock.flushFrame();
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(finalStageSubmitted).toBe(true);
    expect(parentSettled).toBe(false);
    expect(publishDraftSynchronously).not.toHaveBeenCalled();
    clock.flushFrame();
    expect(publishDraftSynchronously).not.toHaveBeenCalled();
    clock.flushFrame();
    await expect(handle.settled).resolves.toMatchObject({ status: 'committed' });
    expect(publishDraftSynchronously).toHaveBeenCalledOnce();
  });
});
