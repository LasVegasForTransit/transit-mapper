import { describe, expect, it, vi } from 'vitest';
import { createDocumentMapScheduler } from '../src/document-map-scheduler';

describe('document map scheduler', () => {
  it('continues cooperative work through tasks when animation frames stall', () => {
    const frames = new Map<number, FrameRequestCallback>();
    const timers = new Map<number, () => void>();
    const tasks = new Map<number, () => void>();
    let nextHandle = 0;
    const dispose = vi.fn();
    const scheduler = createDocumentMapScheduler({
      now: () => 50,
      requestFrame: (callback) => {
        const handle = ++nextHandle;
        frames.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle) => frames.delete(handle),
      setTimer: (callback) => {
        const handle = ++nextHandle;
        timers.set(handle, callback);
        return handle;
      },
      clearTimer: (handle) => timers.delete(handle),
      scheduleTask: (callback) => {
        const handle = ++nextHandle;
        tasks.set(handle, callback);
        return handle;
      },
      cancelTask: (handle) => tasks.delete(handle),
      dispose,
    });
    const first = vi.fn();
    scheduler.scheduleFrame(first);

    expect(frames.size).toBe(1);
    expect(timers.size).toBe(1);
    timers.values().next().value?.();
    expect(first).toHaveBeenCalledOnce();

    const second = vi.fn();
    scheduler.scheduleFrame(second);
    expect(tasks.size).toBe(1);
    tasks.values().next().value?.();
    expect(second).toHaveBeenCalledOnce();

    scheduler.dispose?.();
    expect(dispose).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    expect(timers.size).toBe(0);
    expect(tasks.size).toBe(0);
  });
});
