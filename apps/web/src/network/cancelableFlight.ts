export interface CancelableFlight<T> {
  controller: AbortController;
  promise: Promise<T>;
  waiters: Set<object>;
  settled: boolean;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was canceled.', 'AbortError');
}

/** Starts one underlying operation whose lifetime is owned by its joined
 * callers collectively, not by whichever caller happened to arrive first. */
export function createCancelableFlight<T>(
  run: (signal: AbortSignal) => Promise<T>,
): CancelableFlight<T> {
  const controller = new AbortController();
  const flight: CancelableFlight<T> = {
    controller,
    promise: Promise.resolve(undefined as T),
    waiters: new Set(),
    settled: false,
  };
  flight.promise = run(controller.signal).finally(() => {
    flight.settled = true;
  });
  return flight;
}

/** Joins a running operation while keeping cancellation local to this caller.
 * The underlying work is canceled only when its last interested caller leaves. */
export function joinCancelableFlight<T>(
  flight: CancelableFlight<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  const waiter = {};
  flight.waiters.add(waiter);

  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const release = () => {
      signal?.removeEventListener('abort', onAbort);
      flight.waiters.delete(waiter);
      if (!flight.settled && flight.waiters.size === 0) {
        flight.controller.abort(new DOMException('Every caller canceled.', 'AbortError'));
      }
    };
    const succeed = (value: T) => {
      if (finished) return;
      finished = true;
      release();
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      release();
      reject(error);
    };
    const onAbort = () => fail(abortReason(signal!));

    signal?.addEventListener('abort', onAbort, { once: true });
    flight.promise.then(succeed, fail);
  });
}
