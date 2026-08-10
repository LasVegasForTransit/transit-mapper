import type {
  OsmImportEvent,
  OsmImportRequest,
  OsmImportWorkerMessage,
} from './osm-import-protocol';
import { tileImportArea } from '@transitmapper/core/model/import-area';

interface OsmImportWorker {
  onmessage: ((event: MessageEvent<OsmImportEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: OsmImportWorkerMessage): void;
  terminate(): void;
}

interface StartOsmImportWorkerOptions {
  onEvent: (event: OsmImportEvent) => void;
  workerFactory?: () => OsmImportWorker;
}

export interface RunningOsmImport {
  cancel: () => void;
  completion: Promise<OsmImportEvent>;
}

function createWorker(): OsmImportWorker {
  return new Worker(new URL('./osm-import-worker.ts', import.meta.url), {
    type: 'module',
    name: 'transitmapper-osm-import',
  });
}

/** Start the dedicated import Worker and keep it alive long enough to flush cancellation. */
export function startOsmImportWorker(
  request: OsmImportRequest,
  options: StartOsmImportWorkerOptions,
): RunningOsmImport {
  const worker = (options.workerFactory ?? createWorker)();
  let settled = false;
  let resolveCompletion!: (event: OsmImportEvent) => void;
  const completion = new Promise<OsmImportEvent>((resolve) => {
    resolveCompletion = resolve;
  });
  const finish = (event: OsmImportEvent) => {
    if (settled) return;
    settled = true;
    options.onEvent(event);
    worker.terminate();
    resolveCompletion(event);
  };
  worker.onmessage = (message) => {
    const event = message.data;
    if (event.operationId !== request.operationId) return;
    if (event.type === 'done' || event.type === 'canceled' || event.type === 'error') finish(event);
    else options.onEvent(event);
  };
  worker.onerror = (event) => {
    finish({
      type: 'error',
      operationId: request.operationId,
      completedTiles: 0,
      totalTiles: 0,
      convertedWays: 0,
      missedTiles: request.tiles ?? tileImportArea(request.bounds),
      message: event.message || 'OpenStreetMap import Worker failed.',
    });
  };
  worker.postMessage({ type: 'start', request });
  return {
    cancel: () => {
      if (!settled) worker.postMessage({ type: 'cancel', operationId: request.operationId });
    },
    completion,
  };
}
