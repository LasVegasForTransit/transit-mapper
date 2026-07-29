import type { SvgWorkerEvent, SvgWorkerRequest } from './svgWorkerProtocol';

const SVG_EXPORT_TIMEOUT_MS = 20_000;

export interface SvgRenderWorker {
  onmessage: ((event: MessageEvent<SvgWorkerEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: SvgWorkerRequest): void;
  terminate(): void;
}

export interface SvgWorkerOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  workerFactory?: () => SvgRenderWorker;
}

function defaultWorkerFactory(): SvgRenderWorker {
  return new Worker(new URL('./svgWorkerEntry.ts', import.meta.url), {
    type: 'module',
    name: 'transitmapper-svg-export',
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('SVG export was canceled.', 'AbortError');
}

/** Run the geometry-heavy SVG projection in a short-lived Worker. Keeping a
 * Worker around after export would retain an agency-scale structured clone;
 * one operation per Worker makes close/cancel both prompt and leak-free. */
export function renderSvgInWorker(
  request: SvgWorkerRequest,
  options: SvgWorkerOptions = {},
): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(abortError(options.signal));
  const worker = (options.workerFactory ?? defaultWorkerFactory)();

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const finish = (markup?: string, error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(markup ?? '');
    };
    const onAbort = () => finish(undefined, abortError(options.signal!));
    const timer = setTimeout(
      () => finish(undefined, new Error('SVG export timed out.')),
      options.timeoutMs ?? SVG_EXPORT_TIMEOUT_MS,
    );

    worker.onmessage = (event) => {
      if (event.data.kind === 'error') {
        finish(undefined, new Error(event.data.message));
        return;
      }
      finish(event.data.markup);
    };
    worker.onerror = (event) => finish(undefined, new Error(event.message || 'SVG Worker failed.'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      worker.postMessage(request);
    } catch (error) {
      finish(
        undefined,
        error instanceof Error ? error : new Error('Could not start the SVG export Worker.'),
      );
    }
  });
}
