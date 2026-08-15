import { parseSystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type {
  StorageDeserializerEvent,
  StorageDeserializerRequest,
} from './storage-deserializer-protocol';
import { DESERIALIZE_END_MARK, DESERIALIZE_START_MARK, markOnce } from '../perf/startup-marks';

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
  markOnce(DESERIALIZE_START_MARK);
  let worker: StorageDeserializerWorker;
  try {
    worker = (options.workerFactory ?? createWorker)();
  } catch {
    try {
      return Promise.resolve(parseSystem(JSON.parse(serialized)));
    } finally {
      markOnce(DESERIALIZE_END_MARK);
    }
  }
  return new Promise<TransitSystem>((resolve, reject) => {
    let settled = false;
    const complete = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      markOnce(DESERIALIZE_END_MARK);
      return true;
    };
    const finish = (result: { system: TransitSystem } | { error: Error }) => {
      if (!complete()) return;
      if ('system' in result) resolve(result.system);
      else reject(result.error);
    };
    const fallback = () => {
      if (settled) return;
      try {
        const system = parseSystem(JSON.parse(serialized));
        if (complete()) resolve(system);
      } catch (error) {
        if (complete()) {
          reject(error instanceof Error ? error : new Error('Stored document is invalid.'));
        }
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
