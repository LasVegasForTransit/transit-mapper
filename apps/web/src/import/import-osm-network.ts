import type { ImportBBox, ImportCategory, ImportedNetwork } from '@transitmapper/core/model/import';
import type { DrivingSide } from '@transitmapper/core/model/system';
import type { OsmImportEvent, OsmImportRequest } from './osm-import-protocol';

interface OsmImportWorker {
  onmessage: ((event: MessageEvent<OsmImportEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(request: OsmImportRequest): void;
  terminate(): void;
}

export interface ImportOsmNetworkOptions {
  signal?: AbortSignal;
  /** Injectable seam for deterministic browser-unit tests. */
  workerFactory?: () => OsmImportWorker;
}

function defaultWorkerFactory(): OsmImportWorker {
  return new Worker(new URL('./osm-import-worker.ts', import.meta.url), {
    type: 'module',
    name: 'transitmapper-osm-import',
  });
}

function abortError(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('OSM import canceled.', 'AbortError');
}

function restoredError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** Run network access and OSM translation off the main thread. Only the
 * cloneable request and resulting model records cross the Worker boundary. */
export function importOsmNetwork(
  bbox: ImportBBox,
  categories: ImportCategory[],
  drivingSide: DrivingSide = 'right',
  options: ImportOsmNetworkOptions = {},
): Promise<ImportedNetwork> {
  if (options.signal?.aborted) return Promise.reject(abortError(options.signal));
  const worker = (options.workerFactory ?? defaultWorkerFactory)();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      outcome: { ok: true; network: ImportedNetwork } | { ok: false; error: Error },
    ) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      if (outcome.ok) resolve(outcome.network);
      else reject(outcome.error);
    };
    const onAbort = () => finish({ ok: false, error: abortError(options.signal) });

    worker.onmessage = (event) => {
      if (event.data.kind === 'done') {
        finish({ ok: true, network: event.data.network });
        return;
      }
      finish({
        ok: false,
        error: restoredError(event.data.error.name, event.data.error.message),
      });
    };
    worker.onerror = (event) => {
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || 'OSM import Worker failed.');
      finish({ ok: false, error });
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    try {
      worker.postMessage({ bbox, categories, drivingSide });
    } catch (error) {
      finish({
        ok: false,
        error: error instanceof Error ? error : new Error('OSM import Worker failed.'),
      });
    }
  });
}
