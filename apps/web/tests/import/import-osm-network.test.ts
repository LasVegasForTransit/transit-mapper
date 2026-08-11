import type { ImportedNetwork } from '@transitmapper/core/model/import';
import { describe, expect, it } from 'vitest';
import { importOsmNetwork } from '../../src/import/import-osm-network';
import type { OsmImportEvent, OsmImportRequest } from '../../src/import/osm-import-protocol';

const emptyNetwork: ImportedNetwork = {
  ways: [],
  nodes: [],
  namedWays: [],
  medians: [],
  turnRestrictions: [],
};

class FakeOsmImportWorker {
  onmessage: ((event: MessageEvent<OsmImportEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request: OsmImportRequest | null = null;
  terminated = false;

  postMessage(request: OsmImportRequest): void {
    this.request = request;
    queueMicrotask(() =>
      this.onmessage?.({
        data: { kind: 'done', network: emptyNetwork },
      } as MessageEvent<OsmImportEvent>),
    );
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('OSM import Worker', () => {
  it('sends only cloneable import inputs and releases the Worker after success', async () => {
    const worker = new FakeOsmImportWorker();
    const bbox = { west: -115.2, south: 36.1, east: -115.1, north: 36.2 };

    await expect(
      importOsmNetwork(bbox, ['road', 'bike'], 'right', { workerFactory: () => worker }),
    ).resolves.toBe(emptyNetwork);

    expect(worker.request).toEqual({ bbox, categories: ['road', 'bike'], drivingSide: 'right' });
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it('restores the serialized Worker error name and message', async () => {
    const worker = new FakeOsmImportWorker();
    worker.postMessage = () => {
      queueMicrotask(() =>
        worker.onmessage?.({
          data: { kind: 'error', error: { name: 'TypeError', message: 'Bad OSM response.' } },
        } as MessageEvent<OsmImportEvent>),
      );
    };

    await expect(
      importOsmNetwork({ west: 0, south: 0, east: 1, north: 1 }, ['road'], 'left', {
        workerFactory: () => worker,
      }),
    ).rejects.toMatchObject({ name: 'TypeError', message: 'Bad OSM response.' });

    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it('terminates the Worker and rejects with the AbortSignal reason', async () => {
    const worker = new FakeOsmImportWorker();
    worker.postMessage = (request) => {
      worker.request = request;
    };
    const controller = new AbortController();
    const pending = importOsmNetwork(
      { west: 0, south: 0, east: 1, north: 1 },
      ['lightRail'],
      'right',
      { signal: controller.signal, workerFactory: () => worker },
    );

    controller.abort(new DOMException('Canceled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Canceled' });
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it('does not create a Worker for an already-canceled request', async () => {
    const controller = new AbortController();
    controller.abort();
    let created = false;

    await expect(
      importOsmNetwork({ west: 0, south: 0, east: 1, north: 1 }, [], 'right', {
        signal: controller.signal,
        workerFactory: () => {
          created = true;
          return new FakeOsmImportWorker();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(created).toBe(false);
  });
});
