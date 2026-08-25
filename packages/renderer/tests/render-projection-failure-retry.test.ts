import { describe, expect, it, vi } from 'vitest';
import { scheduleRenderProjectionFailureRetry } from '../src/committed-feature-projection';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('render projection failure retry', () => {
  it('requeues the failed current revision immediately and retries only after retained-scene heal', async () => {
    const recovery = deferred();
    const events: string[] = [];
    const requeue = vi.fn(() => events.push('requeue-current'));
    const schedule = vi.fn(() => events.push('schedule-current'));
    const completePreviousLease = vi.fn(() => events.push('complete-previous'));
    const batch = { revision: 'current-model-revision' };

    scheduleRenderProjectionFailureRetry({
      batch,
      requeue,
      whenRecovered: () => recovery.promise,
      schedule,
      completePreviousLease,
      failPreviousLease: vi.fn(),
    });

    expect(requeue).toHaveBeenCalledWith(batch);
    expect(schedule).not.toHaveBeenCalled();
    recovery.resolve();
    await recovery.promise;
    await Promise.resolve();

    expect(events).toEqual(['requeue-current', 'schedule-current', 'complete-previous']);
  });
});
