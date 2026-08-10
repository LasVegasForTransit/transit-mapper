import { runOsmImport } from './osm-import-runtime';
import type { OsmImportEvent, OsmImportWorkerMessage } from './osm-import-protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<OsmImportWorkerMessage>) => void) | null;
  postMessage(message: OsmImportEvent): void;
}

const workerScope = globalThis as unknown as WorkerScope;
let active: { operationId: number; controller: AbortController } | null = null;

workerScope.onmessage = (event) => {
  if (event.data.type === 'cancel') {
    if (active?.operationId === event.data.operationId) {
      active.controller.abort(new DOMException('OpenStreetMap import canceled.', 'AbortError'));
    }
    return;
  }

  active?.controller.abort(new DOMException('Superseded by a newer import.', 'AbortError'));
  const { request } = event.data;
  const controller = new AbortController();
  active = { operationId: request.operationId, controller };
  void runOsmImport(request, {
    signal: controller.signal,
    emit: (message) => workerScope.postMessage(message),
  }).finally(() => {
    if (active?.operationId === request.operationId) active = null;
  });
};
