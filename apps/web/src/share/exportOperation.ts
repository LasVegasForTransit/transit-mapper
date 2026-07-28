const EXPORT_FRAME_TIMEOUT_MS = 20_000;

export interface ExportFrameSource {
  once(type: 'idle', listener: () => void): void;
  off(type: 'idle', listener: () => void): void;
  triggerRepaint(): void;
}

export interface WaitForExportFrameOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Export was canceled.', 'AbortError');
}

/** Wait for the exact frame being captured, with a real completion signal.
 * This replaces the export dialog's guessed delay and gives close/cancel and
 * a hard timeout somewhere to terminate the wait. */
export function waitForExportFrame(
  map: ExportFrameSource,
  options: WaitForExportFrameOptions = {},
): Promise<void> {
  if (options.signal?.aborted) return Promise.reject(abortError(options.signal));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      map.off('idle', onIdle);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onIdle = () => finish();
    const onAbort = () => finish(abortError(options.signal!));
    const timer = setTimeout(
      () => finish(new Error('Export rendering timed out.')),
      options.timeoutMs ?? EXPORT_FRAME_TIMEOUT_MS,
    );

    map.once('idle', onIdle);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    map.triggerRepaint();
  });
}
