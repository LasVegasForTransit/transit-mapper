import type { GtfsImportBatch } from '@transitmapper/core/model/gtfsImport';
import type {
  PublishedGtfsFeed,
  PublishedGtfsFeedsResponse,
} from '@transitmapper/core/model/gtfs-feed';
import { apiV1Path } from '@transitmapper/core/api/version';
import { fetchWithTimeout } from '../network/fetchWithTimeout';
import type { GtfsWorkerEvent, GtfsWorkerPhase, GtfsWorkerRequest } from './gtfsWorkerProtocol';

const GTFS_DOWNLOAD_TIMEOUT_MS = 60_000;
const GTFS_WORKER_IDLE_TIMEOUT_MS = 30_000;
const GTFS_WORKER_HARD_TIMEOUT_MS = 120_000;

export async function loadPublishedGtfsFeeds(
  fetcher: typeof fetch = fetch,
): Promise<PublishedGtfsFeed[]> {
  const response = await fetcher(apiV1Path('/gtfs'));
  if (!response.ok) {
    throw new Error(`Published transit feeds are unavailable (${response.status}).`);
  }
  const payload = (await response.json()) as PublishedGtfsFeedsResponse;
  return payload.feeds;
}

interface GtfsWorker {
  onmessage: ((event: MessageEvent<GtfsWorkerEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: GtfsWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export interface StreamGtfsFeedOptions {
  feed: PublishedGtfsFeed;
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
  return new Worker(new URL('./gtfsWorker.ts', import.meta.url), {
    type: 'module',
    name: 'transitmapper-gtfs-import',
  });
}

function abortError(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The GTFS import was canceled.', 'AbortError');
}

/** The managed-feed API owns user-facing failure context. Preserve that
 * message instead of replacing a missing archive or server failure with the
 * outer HTTP status alone. */
async function importFailureMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === 'object' && 'error' in body) {
      const { error } = body;
      if (typeof error === 'string' && error.length > 0) return error;
    }
  } catch {
    // Not JSON, so the status is genuinely all we know.
  }
  return `GTFS import failed (${response.status}).`;
}

async function downloadManagedArchive(options: StreamGtfsFeedOptions): Promise<ArrayBuffer> {
  options.onPhase?.('downloading');
  const response = await fetchWithTimeout(
    apiV1Path(`/gtfs/${encodeURIComponent(options.feed.slug)}`),
    {},
    {
      signal: options.signal,
      timeoutMs: GTFS_DOWNLOAD_TIMEOUT_MS,
      fetcher: options.fetcher,
    },
  );
  if (!response.ok) throw new Error(await importFailureMessage(response));
  const archive = await response.arrayBuffer();
  if (options.signal?.aborted) throw abortError(options.signal);
  return archive;
}

class GtfsWorkerSession {
  private readonly events: GtfsWorkerEvent[] = [];
  private wake: (() => void) | null = null;
  private failure: Error | null = null;
  private idleTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private hardTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  constructor(
    private readonly worker: GtfsWorker,
    private readonly options: StreamGtfsFeedOptions,
  ) {
    worker.onmessage = (event) => {
      this.events.push(event.data);
      if (event.data.kind === 'phase' || event.data.kind === 'batch') this.resetIdleTimer();
      else this.clearTimers();
      this.notify();
    };
    worker.onerror = (event) => {
      this.fail(new Error(event.message || 'GTFS Worker failed.'));
    };
    options.signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  start(archive: ArrayBuffer): void {
    const request: GtfsWorkerRequest = {
      archive,
      batchSize: Math.max(1, Math.floor(this.options.batchSize ?? 2)),
    };
    this.resetIdleTimer();
    this.hardTimer = globalThis.setTimeout(
      () => this.fail(new Error('GTFS Worker exceeded the overall processing deadline.')),
      this.options.workerHardTimeoutMs ?? GTFS_WORKER_HARD_TIMEOUT_MS,
    );
    this.worker.postMessage(request, [archive]);
  }

  async nextEvent(): Promise<GtfsWorkerEvent> {
    for (;;) {
      const failure = this.failure;
      if (failure !== null) throw failure;
      const event = this.events.shift();
      if (event !== undefined) return event;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  close(): void {
    this.clearTimers();
    this.options.signal?.removeEventListener('abort', this.onAbort);
    this.worker.terminate();
  }

  private readonly onAbort = (): void => {
    this.fail(abortError(this.options.signal));
  };

  private notify(): void {
    const resolve = this.wake;
    this.wake = null;
    resolve?.();
  }

  private clearTimers(): void {
    if (this.idleTimer !== null) globalThis.clearTimeout(this.idleTimer);
    if (this.hardTimer !== null) globalThis.clearTimeout(this.hardTimer);
    this.idleTimer = null;
    this.hardTimer = null;
  }

  private fail(error: Error): void {
    if (this.failure !== null) return;
    this.failure = error;
    this.clearTimers();
    this.worker.terminate();
    this.notify();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) globalThis.clearTimeout(this.idleTimer);
    this.idleTimer = globalThis.setTimeout(
      () => this.fail(new Error('GTFS Worker stopped making progress.')),
      this.options.workerIdleTimeoutMs ?? GTFS_WORKER_IDLE_TIMEOUT_MS,
    );
  }
}

/** Download one managed archive, then hand every CPU-heavy phase to a dedicated
 * Worker. The async generator yields one bounded batch at a time and yields a
 * main-thread task between batches so store commits and pointer input can
 * interleave. */
export async function* streamGtfsFeedBatches(
  options: StreamGtfsFeedOptions,
): AsyncGenerator<GtfsImportBatch> {
  const archive = await downloadManagedArchive(options);
  const worker = (options.workerFactory ?? defaultWorkerFactory)();
  const session = new GtfsWorkerSession(worker, options);

  try {
    session.start(archive);
    for (;;) {
      const event = await session.nextEvent();
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
    session.close();
  }
}
