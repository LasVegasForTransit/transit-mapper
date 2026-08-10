import { describe, expect, it } from 'vitest';
import { tileImportArea } from '@transitmapper/core/model/import-area';
import type {
  OsmImportEvent,
  OsmImportRequest,
  OsmImportWorkerMessage,
} from '../../src/import/osm-import-protocol';
import { startOsmImportWorker } from '../../src/import/start-osm-import-worker';

class FakeWorker {
  onmessage: ((event: MessageEvent<OsmImportEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: OsmImportWorkerMessage[] = [];
  terminated = false;

  postMessage(message: OsmImportWorkerMessage): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const request: OsmImportRequest = {
  operationId: 42,
  targetSystemId: 'metro',
  bounds: { west: -115.2, south: 36, east: -115, north: 36.2 },
  categories: ['road', 'bike'],
  drivingSide: 'right',
};

describe('startOsmImportWorker', () => {
  it('reports every initial tile as retryable when the Worker itself fails', async () => {
    const worker = new FakeWorker();
    const running = startOsmImportWorker(request, {
      workerFactory: () => worker,
      onEvent: () => {},
    });

    worker.onerror?.({ message: 'Worker crashed.' } as ErrorEvent);

    await expect(running.completion).resolves.toMatchObject({
      type: 'error',
      missedTiles: tileImportArea(request.bounds),
    });
    expect(worker.terminated).toBe(true);
  });
});
