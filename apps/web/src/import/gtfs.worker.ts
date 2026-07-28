import { gtfsArchiveToBatches } from '@transitmapper/core/model/gtfsImport';
import type { GtfsWorkerEvent, GtfsWorkerRequest } from './gtfsWorkerProtocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<GtfsWorkerRequest>) => void) | null;
  postMessage(message: GtfsWorkerEvent): void;
}

const workerScope = globalThis as unknown as WorkerScope;
const post = (message: GtfsWorkerEvent): void => workerScope.postMessage(message);

workerScope.onmessage = (event) => {
  void (async () => {
    try {
      post({ kind: 'phase', phase: 'inflate-and-index' });
      const batches = gtfsArchiveToBatches(
        new Uint8Array(event.data.archive),
        event.data.batchSize,
      );
      post({ kind: 'phase', phase: 'building-routes' });
      for (const batch of batches) {
        post({ kind: 'batch', batch });
        // Let cancellation messages terminate this Worker between bounded
        // route batches instead of monopolizing its own event loop.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      post({ kind: 'done' });
    } catch (error) {
      post({
        kind: 'error',
        message: error instanceof Error ? error.message : 'GTFS processing failed.',
      });
    }
  })();
};
