import { describe, expect, it, vi } from 'vitest';
import { createPresentationRefreshScheduler } from '@transitmapper/map/driver';

class SchedulerClock {
  nowMs = 0;
  private nextHandle = 1;
  readonly frames = new Map<number, () => void>();
  readonly timers = new Map<number, { at: number; callback: () => void }>();

  scheduleFrame = (callback: () => void): number => {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  };

  cancelFrame = (handle: number): void => {
    this.frames.delete(handle);
  };

  scheduleTimer = (callback: () => void, delayMs: number): number => {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.nowMs + delayMs, callback });
    return handle;
  };

  cancelTimer = (handle: number): void => {
    this.timers.delete(handle);
  };

  flushFrame(): void {
    const entry = this.frames.entries().next();
    if (entry.done) throw new Error('No frame is scheduled.');
    const [handle, callback] = entry.value;
    this.frames.delete(handle);
    callback();
  }

  advanceTo(nowMs: number): void {
    this.nowMs = nowMs;
    for (const [handle, timer] of [...this.timers]) {
      if (timer.at > nowMs) continue;
      this.timers.delete(handle);
      timer.callback();
    }
  }
}

function harness(intervalMs = 80, onRequest?: () => void) {
  const clock = new SchedulerClock();
  const refresh = vi.fn();
  const scheduler = createPresentationRefreshScheduler({
    intervalMs,
    now: () => clock.nowMs,
    scheduleFrame: clock.scheduleFrame,
    cancelFrame: clock.cancelFrame,
    scheduleTimer: clock.scheduleTimer,
    cancelTimer: clock.cancelTimer,
    refresh,
    ...(onRequest ? { onRequest } : {}),
  });
  return { clock, refresh, scheduler };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('presentation refresh scheduler', () => {
  it('projects on the next frame for the first camera change', () => {
    const { clock, refresh, scheduler } = harness();

    scheduler.request();
    scheduler.request();

    expect(clock.frames.size).toBe(1);
    expect(clock.timers.size).toBe(0);
    clock.flushFrame();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('invalidates stale presentation work for every request before coalescing it', () => {
    const onRequest = vi.fn();
    const { clock, scheduler } = harness(80, onRequest);

    scheduler.request();
    scheduler.request();

    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(clock.frames.size).toBe(1);
  });

  it('limits continuous camera work and preserves one exact trailing refresh', () => {
    const { clock, refresh, scheduler } = harness();
    scheduler.request();
    clock.flushFrame();

    clock.advanceTo(20);
    scheduler.request();
    clock.advanceTo(50);
    scheduler.request();

    expect(clock.frames.size).toBe(0);
    expect(clock.timers.size).toBe(1);
    clock.advanceTo(79);
    expect(clock.frames.size).toBe(0);
    clock.advanceTo(80);
    expect(clock.frames.size).toBe(1);
    clock.flushFrame();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('continues at the bounded cadence during a long camera gesture', () => {
    const { clock, refresh, scheduler } = harness(50);
    scheduler.request();
    clock.flushFrame();

    for (const nowMs of [10, 20, 30, 40]) {
      clock.advanceTo(nowMs);
      scheduler.request();
    }
    clock.advanceTo(50);
    clock.flushFrame();
    clock.advanceTo(60);
    scheduler.request();
    clock.advanceTo(100);
    clock.flushFrame();

    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('cancels pending camera work on disposal', () => {
    const { clock, refresh, scheduler } = harness();
    scheduler.request();
    scheduler.dispose();

    expect(clock.frames.size).toBe(0);
    expect(clock.timers.size).toBe(0);
    scheduler.request();
    expect(clock.frames.size).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('settles only after scheduled and asynchronous refresh work completes', async () => {
    const clock = new SchedulerClock();
    const refreshWork = deferred();
    const scheduler = createPresentationRefreshScheduler({
      intervalMs: 80,
      now: () => clock.nowMs,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
      scheduleTimer: clock.scheduleTimer,
      cancelTimer: clock.cancelTimer,
      refresh: () => refreshWork.promise,
    });

    scheduler.request();
    let settled = false;
    const waiting = scheduler.whenSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    clock.flushFrame();
    await Promise.resolve();
    expect(settled).toBe(false);

    refreshWork.resolve();
    await waiting;
    expect(settled).toBe(true);
  });
});
