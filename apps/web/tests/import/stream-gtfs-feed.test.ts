import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GtfsImportBatch } from '@transitmapper/core/model/gtfsImport';
import type { PublishedGtfsFeed } from '@transitmapper/core/model/gtfs-feed';
import { loadPublishedGtfsFeeds, streamGtfsFeedBatches } from '../../src/import/stream-gtfs-feed';
import type { GtfsWorkerEvent, GtfsWorkerRequest } from '../../src/import/gtfsWorkerProtocol';

class FakeGtfsWorker {
  onmessage: ((event: MessageEvent<GtfsWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  transferred = 0;

  postMessage(_message: GtfsWorkerRequest, transfer: Transferable[]): void {
    this.transferred = transfer.length;
    const batch: GtfsImportBatch = {
      pieces: { ways: [], lines: [], services: [], stops: [], stations: [] },
      routesDone: 2,
      routesTotal: 2,
    };
    queueMicrotask(() => {
      this.onmessage?.({
        data: { kind: 'phase', phase: 'inflate-and-index' },
      } as MessageEvent<GtfsWorkerEvent>);
      this.onmessage?.({
        data: { kind: 'batch', batch },
      } as MessageEvent<GtfsWorkerEvent>);
      this.onmessage?.({
        data: { kind: 'done' },
      } as MessageEvent<GtfsWorkerEvent>);
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(event: GtfsWorkerEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<GtfsWorkerEvent>);
  }
}

const fetchArchive = vi.fn(() =>
  Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
) as typeof fetch;
const RTC_FEED: PublishedGtfsFeed = {
  slug: 'rtc',
  name: 'RTC Southern Nevada',
  region: 'Las Vegas Valley, Nevada',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('published GTFS feed catalog', () => {
  it('loads the public feed descriptors from the same-origin API', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        Response.json({
          feeds: [
            {
              slug: 'rtc',
              name: 'RTC Southern Nevada',
              region: 'Las Vegas Valley, Nevada',
            },
          ],
        }),
      ),
    ) as typeof fetch;

    await expect(loadPublishedGtfsFeeds(fetcher)).resolves.toEqual([RTC_FEED]);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/gtfs');
  });

  it('reports that the catalog is unavailable when its request fails', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    ) as typeof fetch;

    await expect(loadPublishedGtfsFeeds(fetcher)).rejects.toThrow(
      'Published transit feeds are unavailable (503).',
    );
  });
});

describe('GTFS Worker stream', () => {
  it('downloads the archive for the selected feed slug', async () => {
    const requests: string[] = [];
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push(requestUrl);
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    }) as typeof fetch;

    for await (const _batch of streamGtfsFeedBatches({
      feed: { slug: 'trimet', name: 'TriMet', region: 'Portland, Oregon' },
      fetcher,
      workerFactory: () => new FakeGtfsWorker(),
    })) {
      // Exhaust the stream so its Worker lifecycle also completes.
    }

    expect(requests).toEqual(['/api/v1/gtfs/trimet']);
  });

  it('transfers the archive and yields Worker batches with phase feedback', async () => {
    const worker = new FakeGtfsWorker();
    const phases: string[] = [];
    const batches: GtfsImportBatch[] = [];

    for await (const batch of streamGtfsFeedBatches({
      feed: RTC_FEED,
      fetcher: fetchArchive,
      workerFactory: () => worker,
      onPhase: (phase) => phases.push(phase),
    })) {
      batches.push(batch);
    }

    expect(phases).toEqual(['downloading', 'inflate-and-index']);
    expect(batches).toHaveLength(1);
    expect(worker.transferred).toBe(1);
    expect(worker.terminated).toBe(true);
  });

  it('reports the agency status the proxy names rather than the proxy status', async () => {
    const refused = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'RTC GTFS feed unavailable (403)' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ) as typeof fetch;

    await expect(
      streamGtfsFeedBatches({
        feed: RTC_FEED,
        fetcher: refused,
        workerFactory: () => new FakeGtfsWorker(),
      }).next(),
    ).rejects.toThrow('RTC GTFS feed unavailable (403)');
  });

  it('falls back to the status when a failed response carries no stated cause', async () => {
    const empty = vi.fn(() =>
      Promise.resolve(new Response('gateway timeout', { status: 504 })),
    ) as typeof fetch;

    await expect(
      streamGtfsFeedBatches({
        feed: RTC_FEED,
        fetcher: empty,
        workerFactory: () => new FakeGtfsWorker(),
      }).next(),
    ).rejects.toThrow('GTFS import failed (504).');
  });

  it('terminates the Worker when the user cancels', async () => {
    const worker = new FakeGtfsWorker();
    let markStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    worker.postMessage = () => markStarted?.();
    const controller = new AbortController();
    const iterator = streamGtfsFeedBatches({
      feed: RTC_FEED,
      fetcher: fetchArchive,
      workerFactory: () => worker,
      signal: controller.signal,
    });
    const pending = iterator.next();

    await started;
    controller.abort(new DOMException('Canceled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
  });

  it('terminates a Worker that never reports processing progress', async () => {
    vi.useFakeTimers();
    const worker = new FakeGtfsWorker();
    let markStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    worker.postMessage = () => markStarted?.();
    const pending = streamGtfsFeedBatches({
      feed: RTC_FEED,
      fetcher: fetchArchive,
      workerFactory: () => worker,
      workerIdleTimeoutMs: 20,
      workerHardTimeoutMs: 100,
    }).next();
    await started;
    const rejection = expect(pending).rejects.toThrow('stopped making progress');

    await vi.advanceTimersByTimeAsync(20);

    await rejection;
    expect(worker.terminated).toBe(true);
  });

  it('resets the inactivity watchdog when the Worker reports progress', async () => {
    vi.useFakeTimers();
    const worker = new FakeGtfsWorker();
    let markStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    worker.postMessage = () => markStarted?.();
    const pending = streamGtfsFeedBatches({
      feed: RTC_FEED,
      fetcher: fetchArchive,
      workerFactory: () => worker,
      workerIdleTimeoutMs: 20,
      workerHardTimeoutMs: 100,
    }).next();
    await started;
    let settled = false;
    void pending.catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(15);
    worker.emit({ kind: 'phase', phase: 'inflate-and-index' });
    await vi.advanceTimersByTimeAsync(15);
    expect(settled).toBe(false);
    const rejection = expect(pending).rejects.toThrow('stopped making progress');

    await vi.advanceTimersByTimeAsync(5);

    await rejection;
  });

  it('enforces an absolute processing deadline despite continued progress', async () => {
    vi.useFakeTimers();
    const worker = new FakeGtfsWorker();
    let markStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    worker.postMessage = () => markStarted?.();
    const pending = streamGtfsFeedBatches({
      feed: RTC_FEED,
      fetcher: fetchArchive,
      workerFactory: () => worker,
      workerIdleTimeoutMs: 20,
      workerHardTimeoutMs: 30,
    }).next();
    await started;

    await vi.advanceTimersByTimeAsync(15);
    worker.emit({ kind: 'phase', phase: 'inflate-and-index' });
    await vi.advanceTimersByTimeAsync(14);
    worker.emit({ kind: 'phase', phase: 'building-routes' });
    const rejection = expect(pending).rejects.toThrow('overall processing deadline');
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(worker.terminated).toBe(true);
  });
});
