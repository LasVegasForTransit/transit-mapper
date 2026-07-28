import type { GtfsImportBatch } from '@transitmapper/core/model/gtfsImport';
import { fetchWithTimeout } from '../network/fetchWithTimeout';
import type { GtfsWorkerEvent, GtfsWorkerPhase, GtfsWorkerRequest } from './gtfsWorkerProtocol';

const GTFS_DOWNLOAD_TIMEOUT_MS = 60_000;
const GTFS_WORKER_IDLE_TIMEOUT_MS = 30_000;
const GTFS_WORKER_HARD_TIMEOUT_MS = 120_000;

interface GtfsWorker {
  onmessage: ((event: MessageEvent<GtfsWorkerEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: GtfsWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export interface StreamRtcGtfsOptions {
  batchSize?: number;
  signal?: AbortSignal;
  onPhase?: (phase: 'downloading' | GtfsWorkerPhase) => void;
  fetcher?: typeof fetch;
  /** Injectable seam for deterministic browser-unit tests. */
  workerFactory?: () => GtfsWorker;
  /** Maximum silence after the Worker starts or last reports progress. */
  workerIdleTimeoutMs?: number;
  /** Absolute ceiling for Worker processing, even while progress continues. */
  workerHardTimeoutMs?: number;
}

function defaultWorkerFactory(): GtfsWorker {
  return new Worker(new URL('./gtfs.worker.ts', import.meta.url), {
    type: 'module',
    name: 'transitmapper-gtfs-import',
  });
}

function abortError(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The GTFS import was canceled.', 'AbortError');
}

/** Download the RTC archive, then hand every CPU-heavy phase to a dedicated
 * Worker. The async generator yields one bounded batch at a time and yields a
 * main-thread task between batches so store commits and pointer input can
 * interleave. */
export async function* streamRtcGtfsBatches(
  options: StreamRtcGtfsOptions = {},
): AsyncGenerator<GtfsImportBatch> {
  options.onPhase?.('downloading');
  const response = await fetchWithTimeout(
    '/api/gtfs/rtc',
    {},
    {
      signal: options.signal,
      timeoutMs: GTFS_DOWNLOAD_TIMEOUT_MS,
      fetcher: options.fetcher,
    },
  );
  if (!response.ok) throw new Error(`GTFS import failed (${response.status}).`);
  const archive = await response.arrayBuffer();
  if (options.signal?.aborted) throw abortError(options.signal);

  const worker = (options.workerFactory ?? defaultWorkerFactory)();
  const events: GtfsWorkerEvent[] = [];
  let wake: (() => void) | null = null;
  let failure: Error | null = null;
  let idleTimer: number | null = null;
  let hardTimer: number | null = null;
  const notify = () => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };
  const clearProcessingTimers = () => {
    if (idleTimer !== null) globalThis.clearTimeout(idleTimer);
    if (hardTimer !== null) globalThis.clearTimeout(hardTimer);
    idleTimer = null;
    hardTimer = null;
  };
  const failProcessing = (error: Error) => {
    if (failure) return;
    failure = error;
    clearProcessingTimers();
    worker.terminate();
    notify();
  };
  const resetIdleTimer = () => {
    if (idleTimer !== null) globalThis.clearTimeout(idleTimer);
    idleTimer = globalThis.setTimeout(
      () => failProcessing(new Error('GTFS Worker stopped making progress.')),
      options.workerIdleTimeoutMs ?? GTFS_WORKER_IDLE_TIMEOUT_MS,
    );
  };
  worker.onmessage = (event) => {
    events.push(event.data);
    if (event.data.kind === 'phase' || event.data.kind === 'batch') resetIdleTimer();
    else clearProcessingTimers();
    notify();
  };
  worker.onerror = (event) => {
    failProcessing(new Error(event.message || 'GTFS Worker failed.'));
  };
  const onAbort = () => {
    failure = abortError(options.signal);
    clearProcessingTimers();
    worker.terminate();
    notify();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const request: GtfsWorkerRequest = {
      archive,
      batchSize: Math.max(1, Math.floor(options.batchSize ?? 2)),
    };
    resetIdleTimer();
    hardTimer = globalThis.setTimeout(
      () => failProcessing(new Error('GTFS Worker exceeded the overall processing deadline.')),
      options.workerHardTimeoutMs ?? GTFS_WORKER_HARD_TIMEOUT_MS,
    );
    worker.postMessage(request, [archive]);

    for (;;) {
      if (failure) throw failure;
      if (events.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      const event = events.shift()!;
      if (event.kind === 'phase') {
        options.onPhase?.(event.phase);
        continue;
      }
      if (event.kind === 'error') throw new Error(event.message);
      if (event.kind === 'done') return;
      yield event.batch;
      // A Worker can enqueue many messages before the browser paints. Make
      // each next() cross a task boundary so route commits remain interruptible.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    clearProcessingTimers();
    options.signal?.removeEventListener('abort', onAbort);
    worker.terminate();
  }
}
