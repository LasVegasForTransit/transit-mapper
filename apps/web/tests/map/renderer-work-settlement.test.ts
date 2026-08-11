import { describe, expect, it, vi } from 'vitest';
import { createRendererWorkSettlementTracker } from '../../src/map/render-settlement';

describe('renderer work settlement', () => {
  it('waits for every scheduled or active render generation', async () => {
    const tracker = createRendererWorkSettlementTracker();
    const first = tracker.begin();
    const second = tracker.begin();
    const settled = vi.fn();
    void tracker.whenSettled().then(settled);

    first.complete();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    second.complete();
    await tracker.whenSettled();

    expect(settled).toHaveBeenCalledOnce();
  });

  it('reports a failed generation while a later generation clears the barrier', async () => {
    const tracker = createRendererWorkSettlementTracker();
    const failed = tracker.begin();
    failed.fail(new Error('projection failed'));

    await expect(tracker.whenSettled()).rejects.toThrow('projection failed');
    const retry = tracker.begin();
    retry.complete();
    await expect(tracker.whenSettled()).resolves.toBeUndefined();
  });

  it('releases capture waiters when disposed', async () => {
    const tracker = createRendererWorkSettlementTracker();
    tracker.begin();
    const settled = tracker.whenSettled();

    tracker.dispose();

    await expect(settled).resolves.toBeUndefined();
  });
});
