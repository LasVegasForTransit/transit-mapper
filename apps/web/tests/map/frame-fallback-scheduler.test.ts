import { describe, expect, it } from 'vitest';
import { createFrameFallbackScheduler } from '../../src/map/frame-fallback-scheduler';

interface ScheduledCallback {
  callback: (time: number) => void;
}

function createHarness() {
  let nextHandle = 0;
  let now = 100;
  const frames = new Map<number, ScheduledCallback>();
  const timeouts = new Map<number, () => void>();
  const scheduler = createFrameFallbackScheduler({
    requestAnimationFrame: (callback) => {
      const handle = ++nextHandle;
      frames.set(handle, { callback });
      return handle;
    },
    cancelAnimationFrame: (handle) => frames.delete(handle),
    setTimeout: (callback) => {
      const handle = ++nextHandle;
      timeouts.set(handle, callback);
      return handle;
    },
    clearTimeout: (handle) => timeouts.delete(handle),
    now: () => now,
  });
  return {
    scheduler,
    runFrame(handle: number, time = 120) {
      frames.get(handle)?.callback(time);
    },
    runFallback(handle: number) {
      timeouts.get(handle)?.();
    },
    frameHandles: () => [...frames.keys()],
    timeoutHandles: () => [...timeouts.keys()],
    setNow(value: number) {
      now = value;
    },
  };
}

describe('frame fallback scheduler', () => {
  it('runs work once from the animation frame and clears its fallback', () => {
    const harness = createHarness();
    const observed: number[] = [];

    harness.scheduler.scheduleFrame((time) => observed.push(time));
    const [frame] = harness.frameHandles();
    harness.runFrame(frame);

    expect(observed).toEqual([120]);
    expect(harness.timeoutHandles()).toEqual([]);
  });

  it('runs work once from the timer when the animation frame is deferred', () => {
    const harness = createHarness();
    const observed: number[] = [];

    harness.scheduler.scheduleFrame((time) => observed.push(time));
    const [fallback] = harness.timeoutHandles();
    harness.setNow(151);
    harness.runFallback(fallback);

    expect(observed).toEqual([151]);
    expect(harness.frameHandles()).toEqual([]);
  });

  it('cancels both pending callbacks', () => {
    const harness = createHarness();
    const observed: number[] = [];

    const handle = harness.scheduler.scheduleFrame((time) => observed.push(time));
    harness.scheduler.cancelFrame(handle);

    expect(harness.frameHandles()).toEqual([]);
    expect(harness.timeoutHandles()).toEqual([]);
    expect(observed).toEqual([]);
  });
});
