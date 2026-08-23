export interface FrameFallbackSchedulerOptions {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  scheduleTask?: (callback: () => void) => number;
  cancelTask?: (handle: number) => void;
  now(): number;
  timeoutMs?: number;
}

export interface FrameFallbackScheduler {
  scheduleFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  dispose(): void;
}

interface PendingFrame {
  frameHandle: number | null;
  timeoutHandle: number | null;
  taskHandle: number | null;
}

/** Animation frames keep renderer work aligned with paint. When one fails to
 * arrive, later preparation slices use regular tasks so a throttled virtual
 * display cannot turn each short slice into a long wait. */
export function createFrameFallbackScheduler(
  options: FrameFallbackSchedulerOptions,
): FrameFallbackScheduler {
  const timeoutMs = options.timeoutMs ?? 50;
  const canScheduleTasks = Boolean(options.scheduleTask && options.cancelTask);
  let nextHandle = 0;
  let useTasks = false;
  const pending = new Map<number, PendingFrame>();

  const cancelPending = (scheduled: PendingFrame): void => {
    if (scheduled.frameHandle !== null) {
      options.cancelAnimationFrame(scheduled.frameHandle);
    }
    if (scheduled.timeoutHandle !== null) {
      options.clearTimeout(scheduled.timeoutHandle);
    }
    if (scheduled.taskHandle !== null && options.cancelTask) {
      options.cancelTask(scheduled.taskHandle);
    }
  };

  const cancelFrame = (handle: number): void => {
    const scheduled = pending.get(handle);
    if (!scheduled) return;
    pending.delete(handle);
    cancelPending(scheduled);
  };

  const scheduleFrame = (callback: FrameRequestCallback): number => {
    const handle = ++nextHandle;
    const flush = (time: number): void => {
      const scheduled = pending.get(handle);
      if (!scheduled) return;
      pending.delete(handle);
      cancelPending(scheduled);
      callback(time);
    };
    const scheduled: PendingFrame = {
      frameHandle: null,
      timeoutHandle: null,
      taskHandle: null,
    };
    pending.set(handle, scheduled);

    if (useTasks && options.scheduleTask) {
      scheduled.taskHandle = options.scheduleTask(() => flush(options.now()));
      return handle;
    }

    scheduled.frameHandle = options.requestAnimationFrame(flush);
    scheduled.timeoutHandle = options.setTimeout(() => {
      if (canScheduleTasks) useTasks = true;
      flush(options.now());
    }, timeoutMs);
    return handle;
  };

  return {
    scheduleFrame,
    cancelFrame,
    dispose: () => {
      for (const handle of [...pending.keys()]) cancelFrame(handle);
    },
  };
}
