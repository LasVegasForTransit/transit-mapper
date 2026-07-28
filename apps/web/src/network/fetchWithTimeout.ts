export const DEFAULT_API_TIMEOUT_MS = 20_000;

export class RequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = 'RequestTimeoutError';
  }
}

export interface FetchWithTimeoutOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Injectable for deterministic tests; production uses the browser fetch. */
  fetcher?: typeof fetch;
}

async function bufferResponse(response: Response, signal: AbortSignal): Promise<Response> {
  if (!response.body) return response;
  let fail: (() => void) | undefined;
  const abort = new Promise<never>((_resolve, reject) => {
    fail = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('The request was canceled.', 'AbortError'),
      );
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
  let bytes: ArrayBuffer;
  try {
    bytes = await Promise.race([response.arrayBuffer(), abort]);
  } finally {
    if (fail) signal.removeEventListener('abort', fail);
  }
  // Buffering here is intentional: every current API consumer immediately
  // calls json/text/arrayBuffer anyway. Returning only after the body closes
  // keeps the same deadline and caller cancellation alive through the bytes,
  // rather than declaring success as soon as headers arrive.
  return new Response(bytes, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Fetch with both caller cancellation and a hard deadline. Keeping this at
 * the network boundary prevents a stalled Worker, proxy, or upstream request
 * from leaving an interaction permanently busy. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const sourceSignal = options.signal ?? init.signal ?? undefined;
  if (sourceSignal?.aborted) {
    throw sourceSignal.reason instanceof Error
      ? sourceSignal.reason
      : new DOMException('The operation was canceled.', 'AbortError');
  }

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(sourceSignal?.reason);
  sourceSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new RequestTimeoutError(timeoutMs));
  }, timeoutMs);

  try {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(input, { ...init, signal: controller.signal });
    return await bufferResponse(response, controller.signal);
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    sourceSignal?.removeEventListener('abort', onAbort);
  }
}
