import { describe, expect, it, vi } from 'vitest';
import { createCooperativeRenderJobScheduler } from '../src/cooperative-render-job-scheduler';
import type { SceneDraft } from '../src/scene-draft';
import { publishSceneDraft } from '../src/scene-publication';
import { emptySystemFeatures } from '../src/system-feature-sources';

class OwnershipFrameClock {
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
  flush(): void {
    const entry = this.frames.entries().next();
    if (entry.done) throw new Error('No frame is scheduled.');
    const [handle, callback] = entry.value;
    this.frames.delete(handle);
    callback();
  }
}

const prepared = {} as SceneDraft;
const input = { revision: 'scene', features: emptySystemFeatures(), sourceIds: [] };

describe('scene publication ownership', () => {
  it('retains submission ownership until the complete source revision paints', async () => {
    const clock = new OwnershipFrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    let releasePaint = () => {};
    const painted = new Promise<void>((resolve) => {
      releasePaint = resolve;
    });
    const handle = publishSceneDraft({
      scheduler,
      controller: {
        draft: () => ({ units: { unitAt: () => undefined }, result: () => prepared }),
        publishDraftSynchronously: () => ({ sourceUploadCount: 1 }),
      },
      input,
      onCommitted: () => painted,
    });

    clock.flush();
    clock.flush();
    let settled = false;
    void handle.settled.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(handle.cancel()).toBe(false);

    releasePaint();
    await expect(handle.settled).resolves.toBeUndefined();
  });

  it('prevents a replaced predecessor from publishing its private draft', async () => {
    const clock = new OwnershipFrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const staleCommit = vi.fn();
    const stale = publishSceneDraft({
      scheduler,
      controller: {
        draft: () => ({
          units: {
            unitAt: (index: number) =>
              index < 3
                ? {
                    id: `stale:${index}`,
                    run: () => {
                      clock.nowMs += 1;
                    },
                  }
                : undefined,
          },
          result: () => prepared,
        }),
        publishDraftSynchronously: staleCommit,
      },
      input,
      batchSize: 1,
    });

    clock.flush();
    const currentCommit = vi.fn();
    const current = publishSceneDraft({
      scheduler,
      controller: {
        draft: () => ({ units: { unitAt: () => undefined }, result: () => prepared }),
        publishDraftSynchronously: currentCommit,
      },
      input: { ...input, revision: 'current' },
    });
    clock.flush();
    clock.flush();

    await expect(stale.settled).resolves.toBeUndefined();
    await expect(current.settled).resolves.toBeUndefined();
    expect(staleCommit).not.toHaveBeenCalled();
    expect(currentCommit).toHaveBeenCalledOnce();
  });
});
