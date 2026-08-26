import { createFrameFallbackScheduler } from './frame-fallback-scheduler';
import type { DocumentMapScheduler } from './document-map-driver-types';

interface DocumentMapSchedulerPlatform {
  now(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, delayMs: number): number;
  clearTimer(handle: number): void;
  scheduleTask(callback: () => void): number;
  cancelTask(handle: number): void;
  dispose(): void;
}

function browserPlatform(): DocumentMapSchedulerPlatform {
  const tasks = new Map<number, () => void>();
  const channel = new MessageChannel();
  let nextTaskHandle = 0;
  channel.port1.onmessage = (event: MessageEvent<number>) => {
    const callback = tasks.get(event.data);
    if (!callback) return;
    tasks.delete(event.data);
    callback();
  };
  return {
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (handle) => window.clearTimeout(handle),
    scheduleTask: (callback) => {
      const handle = ++nextTaskHandle;
      tasks.set(handle, callback);
      channel.port2.postMessage(handle);
      return handle;
    },
    cancelTask: (handle) => tasks.delete(handle),
    dispose() {
      tasks.clear();
      channel.port1.close();
      channel.port2.close();
    },
  };
}

/** Keep cooperative renderer slices moving when a browser or virtual display
 * throttles animation frames. The frame fallback still yields regularly so
 * MapLibre can paint between task batches. */
export function createDocumentMapScheduler(
  platform: DocumentMapSchedulerPlatform = browserPlatform(),
): DocumentMapScheduler {
  const frames = createFrameFallbackScheduler({
    requestAnimationFrame: (callback) => platform.requestFrame(callback),
    cancelAnimationFrame: (handle) => platform.cancelFrame(handle),
    setTimeout: (callback, delayMs) => platform.setTimer(callback, delayMs),
    clearTimeout: (handle) => platform.clearTimer(handle),
    scheduleTask: (callback) => platform.scheduleTask(callback),
    cancelTask: (handle) => platform.cancelTask(handle),
    now: () => platform.now(),
  });
  return {
    now: () => platform.now(),
    scheduleFrame: (callback) => frames.scheduleFrame(callback),
    cancelFrame: (handle) => frames.cancelFrame(handle),
    scheduleTimer: (callback, delayMs) => platform.setTimer(callback, delayMs),
    cancelTimer: (handle) => platform.clearTimer(handle),
    dispose() {
      frames.dispose();
      platform.dispose();
    },
  };
}
