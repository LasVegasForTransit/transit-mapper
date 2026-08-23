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
  const tasksBeforePaint = 16;
  const canScheduleTasks = Boolean(options.scheduleTask && options.cancelTask);
  let nextHandle = 0;
  let taskCount = 0;
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

    if (useTasks) {
      if (options.scheduleTask && taskCount < tasksBeforePaint) {
        taskCount += 1;
        scheduled.taskHandle = options.scheduleTask(() => flush(options.now()));
        return handle;
      }
      // A real animation frame is the only reliable way to let MapLibre paint
      // between task batches. Do not attach the short fallback timer here: it
      // could fire first and cancel the very frame that releases the renderer.
      taskCount = 0;
      scheduled.frameHandle = options.requestAnimationFrame(flush);
      return handle;
    }

    taskCount = 0;
    scheduled.frameHandle = options.requestAnimationFrame(flush);
    scheduled.timeoutHandle = options.setTimeout(() => {
      if (canScheduleTasks) {
        useTasks = true;
        taskCount = 0;
      }
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
