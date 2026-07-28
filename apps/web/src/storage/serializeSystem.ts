import type { TransitSystem } from '@transitmapper/core/model/system';
import type { StorageSerializerEvent, StorageSerializerRequest } from './storageSerializerProtocol';

const SERIALIZATION_TIMEOUT_MS = 20_000;

export interface StorageSerializerWorker {
  onmessage: ((event: MessageEvent<StorageSerializerEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(request: StorageSerializerRequest): void;
  terminate(): void;
}

export interface SerializeSystemOptions {
  timeoutMs?: number;
  workerFactory?: () => StorageSerializerWorker;
}

function defaultWorkerFactory(): StorageSerializerWorker {
  return new Worker(new URL('./storageSerializer.worker.ts', import.meta.url), {
    type: 'module',
    name: 'transitmapper-storage-serializer',
  });
}

/** JSON preparation is the CPU-heavy part of saving an agency-scale document.
 * Keep it away from input handling; IndexedDB owns the durable write once the
 * Worker returns. Environments that prohibit Workers retain the old behavior
 * as a compatibility fallback rather than losing autosave entirely. */
export function serializeSystemOffThread(
  system: TransitSystem,
  options: SerializeSystemOptions = {},
): Promise<string> {
  let worker: StorageSerializerWorker;
  try {
    worker = (options.workerFactory ?? defaultWorkerFactory)();
  } catch {
    return Promise.resolve(JSON.stringify(system));
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (result: { serialized: string } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if ('serialized' in result) resolve(result.serialized);
      else reject(result.error);
    };
    const timer = setTimeout(
      () => finish({ error: new Error('Document serialization timed out.') }),
      options.timeoutMs ?? SERIALIZATION_TIMEOUT_MS,
    );

    worker.onmessage = (event) => {
      if (event.data.kind === 'done') finish({ serialized: event.data.serialized });
      else finish({ error: new Error(event.data.message) });
    };
    worker.onerror = (event) =>
      finish({ error: new Error(event.message || 'Document serialization Worker failed.') });
    try {
      worker.postMessage({ system });
    } catch (error) {
      finish({
        error: error instanceof Error ? error : new Error('Document serialization failed.'),
      });
    }
  });
}
