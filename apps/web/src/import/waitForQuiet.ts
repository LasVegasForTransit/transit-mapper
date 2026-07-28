export interface QuietWindowSource {
  subscribe(listener: () => void): () => void;
}

export interface WaitForQuietOptions {
  quietMs: number;
  signal?: AbortSignal;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was canceled.', 'AbortError');
}

/** Resolves only after the source has stopped changing for one complete
 * window. Heavy snapshot work uses this after a stale result so active
 * editing does not create a procession of immediately obsolete Workers. */
export function waitForQuiet(
  source: QuietWindowSource,
  options: WaitForQuietOptions,
): Promise<void> {
  if (options.signal?.aborted) return Promise.reject(abortReason(options.signal));

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    let unsubscribe = () => {};
    const cleanup = () => {
      clearTimeout(timer);
      unsubscribe();
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(finish, options.quietMs);
    };
    const onAbort = () => {
      cleanup();
      reject(abortReason(options.signal!));
    };

    unsubscribe = source.subscribe(schedule);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    schedule();
  });
}
