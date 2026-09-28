import type { ResolveOptions } from '../../src/network/content-provider';

export function waitForProviderAbort<Value>(
  message: string,
  options?: ResolveOptions,
): Promise<Value> {
  return new Promise((_resolve, reject) => {
    const signal = options?.signal;
    if (!signal) {
      reject(new Error('The provider did not receive an AbortSignal.'));
      return;
    }
    const rejectAsAborted = (): void => reject(new Error(message));
    if (signal.aborted) {
      rejectAsAborted();
      return;
    }
    signal.addEventListener('abort', rejectAsAborted, { once: true });
  });
}
