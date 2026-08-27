import { describe, expect, it } from 'vitest';
import { createFrameFallbackScheduler } from '../src/projection/frame-fallback-scheduler';

interface ScheduledCallback {
  callback: (time: number) => void;
}

function createHarness() {
  let nextHandle = 0;
  let now = 100;
  const frames = new Map<number, ScheduledCallback>();
  const timeouts = new Map<number, () => void>();
  const tasks = new Map<number, () => void>();
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
    scheduleTask: (callback) => {
      const handle = ++nextHandle;
      tasks.set(handle, callback);
      return handle;
    },
    cancelTask: (handle) => tasks.delete(handle),
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
    runTask(handle: number) {
      tasks.get(handle)?.();
    },
    frameHandles: () => [...frames.keys()],
    timeoutHandles: () => [...timeouts.keys()],
    taskHandles: () => [...tasks.keys()],
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

  it('uses a task after a missed frame keeps future work from waiting for another frame', () => {
    const harness = createHarness();
    const observed: number[] = [];

    harness.scheduler.scheduleFrame((time) => observed.push(time));
    const [fallback] = harness.timeoutHandles();
    harness.setNow(151);
    harness.runFallback(fallback);

    harness.scheduler.scheduleFrame((time) => observed.push(time));

    expect(harness.frameHandles()).toEqual([]);
    expect(harness.timeoutHandles()).toEqual([]);
    const [task] = harness.taskHandles();
    harness.setNow(152);
    harness.runTask(task);

    expect(observed).toEqual([151, 152]);
  });

  it('cancels a task queued after a missed frame', () => {
    const harness = createHarness();
    const observed: number[] = [];

    harness.scheduler.scheduleFrame((time) => observed.push(time));
    const [fallback] = harness.timeoutHandles();
    harness.runFallback(fallback);

    const handle = harness.scheduler.scheduleFrame((time) => observed.push(time));
    harness.scheduler.cancelFrame(handle);

    expect(harness.taskHandles()).toEqual([]);
    expect(observed).toEqual([100]);
  });

  it('returns to an animation frame periodically so paint cannot be starved', () => {
    const harness = createHarness();
    const observed: number[] = [];

    harness.scheduler.scheduleFrame((time) => observed.push(time));
    const [fallback] = harness.timeoutHandles();
    harness.runFallback(fallback);

    for (let index = 0; index < 16; index += 1) {
      harness.scheduler.scheduleFrame((time) => observed.push(time));
      const [task] = harness.taskHandles();
      harness.runTask(task);
    }
    harness.scheduler.scheduleFrame((time) => observed.push(time));

    expect(harness.taskHandles()).toHaveLength(1);
    expect(harness.frameHandles()).toHaveLength(1);
    expect(harness.timeoutHandles()).toEqual([]);
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
