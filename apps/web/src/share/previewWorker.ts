import type { PreviewWorkerEvent, PreviewWorkerRequest } from './previewWorkerProtocol';

const PREVIEW_WORKER_TIMEOUT_MS = 10_000;

export interface PreviewWorker {
  onmessage: ((event: MessageEvent<PreviewWorkerEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: PreviewWorkerRequest): void;
  terminate(): void;
}

export interface RenderPreviewMarkupOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  workerFactory?: () => PreviewWorker;
}

function defaultWorkerFactory(): PreviewWorker {
  return new Worker(new URL('./previewWorkerEntry.ts', import.meta.url), {
    type: 'module',
    name: 'transitmapper-share-preview',
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Preview rendering was canceled.', 'AbortError');
}

/** Build the geometry-heavy SVG string away from the input thread. The
 * browser keeps only image decode and canvas encoding, which require DOM
 * APIs; closing or superseding the share terminates this Worker immediately. */
export function renderPreviewMarkup(
  data: string,
  options: RenderPreviewMarkupOptions = {},
): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(abortError(options.signal));
  const worker = (options.workerFactory ?? defaultWorkerFactory)();

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: { markup: string } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      if ('markup' in outcome) resolve(outcome.markup);
      else reject(outcome.error);
    };
    const onAbort = () => finish({ error: abortError(options.signal!) });
    const timer = setTimeout(
      () => finish({ error: new Error('Preview rendering timed out.') }),
      options.timeoutMs ?? PREVIEW_WORKER_TIMEOUT_MS,
    );

    worker.onmessage = (event) => {
      if (event.data.kind === 'done') finish({ markup: event.data.markup });
      else finish({ error: new Error(event.data.message) });
    };
    worker.onerror = (event) =>
      finish({ error: new Error(event.message || 'Preview Worker failed.') });
    options.signal?.addEventListener('abort', onAbort, { once: true });
    worker.postMessage({ data });
  });
}
