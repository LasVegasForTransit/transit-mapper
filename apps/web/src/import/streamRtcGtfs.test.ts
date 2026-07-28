import { describe, expect, it, vi } from 'vitest';
import type { GtfsImportBatch } from '@transitmapper/core/model/gtfsImport';
import { streamRtcGtfsBatches } from './streamRtcGtfs';
import type { GtfsWorkerEvent, GtfsWorkerRequest } from './gtfsWorkerProtocol';

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
}

const fetchArchive = vi.fn(
  async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
) as typeof fetch;

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
});
