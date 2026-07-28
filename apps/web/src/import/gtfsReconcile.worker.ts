import { reconcileImportedSystem } from '../editor/store';
import type { GtfsReconcileEvent, GtfsReconcileRequest } from './gtfsReconcileProtocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<GtfsReconcileRequest>) => void) | null;
  postMessage(message: GtfsReconcileEvent): void;
}

const workerScope = globalThis as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  try {
    const result = reconcileImportedSystem(event.data.system, event.data.serviceIds);
    workerScope.postMessage({ kind: 'done', ...result });
  } catch (error) {
    workerScope.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : 'GTFS reconciliation failed.',
    });
  }
};
