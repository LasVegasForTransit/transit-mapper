import { importOsmWays } from '@transitmapper/core/model/import';
import type { OsmImportEvent, OsmImportRequest } from './osm-import-protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<OsmImportRequest>) => void) | null;
  postMessage(message: OsmImportEvent): void;
}

const workerScope = globalThis as unknown as WorkerScope;

function serializedError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: 'OSM import failed.' };
}

async function handleImport(event: MessageEvent<OsmImportRequest>): Promise<void> {
  try {
    const { bbox, categories, drivingSide } = event.data;
    const network = await importOsmWays(bbox, categories, drivingSide);
    workerScope.postMessage({ kind: 'done', network });
  } catch (error) {
    workerScope.postMessage({ kind: 'error', error: serializedError(error) });
  }
}

workerScope.onmessage = (event) => {
  void handleImport(event);
};
