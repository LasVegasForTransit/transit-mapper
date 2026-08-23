export interface FrameFallbackSchedulerOptions {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  now(): number;
  timeoutMs?: number;
}

export interface FrameFallbackScheduler {
  scheduleFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  dispose(): void;
}

interface PendingFrame {
  readonly frameHandle: number;
  readonly timeoutHandle: number;
}

/** Animation frames keep renderer work aligned with paint. The short timer
 * only runs when a freshly-created browser context suppresses that first
 * frame, which otherwise leaves the document projection stranded forever. */
export function createFrameFallbackScheduler(
  options: FrameFallbackSchedulerOptions,
): FrameFallbackScheduler {
  const timeoutMs = options.timeoutMs ?? 50;
  let nextHandle = 0;
  const pending = new Map<number, PendingFrame>();

  const cancelFrame = (handle: number): void => {
    const scheduled = pending.get(handle);
    if (!scheduled) return;
    pending.delete(handle);
    options.cancelAnimationFrame(scheduled.frameHandle);
    options.clearTimeout(scheduled.timeoutHandle);
  };

  const scheduleFrame = (callback: FrameRequestCallback): number => {
    const handle = ++nextHandle;
    const flush = (time: number): void => {
      const scheduled = pending.get(handle);
      if (!scheduled) return;
      pending.delete(handle);
      options.cancelAnimationFrame(scheduled.frameHandle);
      options.clearTimeout(scheduled.timeoutHandle);
      callback(time);
    };
    const frameHandle = options.requestAnimationFrame(flush);
    const timeoutHandle = options.setTimeout(() => flush(options.now()), timeoutMs);
    pending.set(handle, { frameHandle, timeoutHandle });
    return handle;
  };

  return {
    scheduleFrame,
    cancelFrame,
    dispose: () => {
      for (const handle of pending.keys()) cancelFrame(handle);
    },
  };
}
