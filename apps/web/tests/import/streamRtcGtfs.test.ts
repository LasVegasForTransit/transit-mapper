import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GtfsImportBatch } from '@transitmapper/core/model/gtfsImport';
import { streamRtcGtfsBatches } from '../../src/import/streamRtcGtfs';
import type { GtfsWorkerEvent, GtfsWorkerRequest } from '../../src/import/gtfsWorkerProtocol';

class FakeGtfsWorker {
  onmessage: ((event: MessageEvent<GtfsWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  transferred = 0;

  postMessage(_message: GtfsWorkerRequest, transfer: Transferable[]): void {
    this.transferred = transfer.length;
    const batch: GtfsImportBatch = {
      pieces: { ways: [], services: [], stations: [] },
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

const fetchArchive = vi.fn(
  async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
) as typeof fetch;

afterEach(() => {
  vi.useRealTimers();
});

describe('RTC GTFS Worker stream', () => {
  it('transfers the archive and yields Worker batches with phase feedback', async () => {
    const worker = new FakeGtfsWorker();
    const phases: string[] = [];
    const batches: GtfsImportBatch[] = [];

    for await (const batch of streamRtcGtfsBatches({
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

  it('terminates the Worker when the user cancels', async () => {
    const worker = new FakeGtfsWorker();
    let markStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    worker.postMessage = () => markStarted?.();
    const controller = new AbortController();
    const iterator = streamRtcGtfsBatches({
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
    const pending = streamRtcGtfsBatches({
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
    const pending = streamRtcGtfsBatches({
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
    const pending = streamRtcGtfsBatches({
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
