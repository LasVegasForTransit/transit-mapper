import { parseSystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type {
  StorageDeserializerEvent,
  StorageDeserializerRequest,
} from './storage-deserializer-protocol';

const DESERIALIZATION_TIMEOUT_MS = 20_000;

export interface StorageDeserializerWorker {
  onmessage: ((event: MessageEvent<StorageDeserializerEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(request: StorageDeserializerRequest): void;
  terminate(): void;
}

interface DeserializeSystemOptions {
  timeoutMs?: number;
  workerFactory?: () => StorageDeserializerWorker;
}

function createWorker(): StorageDeserializerWorker {
  return new Worker(new URL('./storage-deserializer-worker.ts', import.meta.url), {
    type: 'module',
    name: 'transitmapper-storage-deserializer',
  });
}

/** Parse JSON and reconstruct the domain model away from browser input handling. */
export function deserializeSystemOffThread(
  serialized: string,
  options: DeserializeSystemOptions = {},
): Promise<TransitSystem> {
  let worker: StorageDeserializerWorker;
  try {
    worker = (options.workerFactory ?? createWorker)();
  } catch {
    return Promise.resolve(parseSystem(JSON.parse(serialized)));
  }
  return new Promise<TransitSystem>((resolve, reject) => {
    let settled = false;
    const finish = (result: { system: TransitSystem } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if ('system' in result) resolve(result.system);
      else reject(result.error);
    };
    const fallback = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      try {
        resolve(parseSystem(JSON.parse(serialized)));
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Stored document is invalid.'));
      }
    };
    const timer = setTimeout(fallback, options.timeoutMs ?? DESERIALIZATION_TIMEOUT_MS);
    worker.onmessage = (event) => {
      if (event.data.kind === 'done') finish({ system: event.data.system });
      else finish({ error: new Error(event.data.message) });
    };
    // Worker startup/runtime failures are capability failures, not evidence
    // that the user's stored bytes are corrupt. Preserve the compatibility
    // path used by serialization and parse on the main thread as a last resort.
    worker.onerror = fallback;
    try {
      worker.postMessage({ serialized });
    } catch {
      fallback();
    }
  });
}
