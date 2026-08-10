import { parseSystem } from '@transitmapper/core/model/serialize';
import type {
  StorageDeserializerEvent,
  StorageDeserializerRequest,
} from './storage-deserializer-protocol';

interface StorageDeserializerWorkerScope {
  onmessage: ((event: MessageEvent<StorageDeserializerRequest>) => void) | null;
  postMessage(message: StorageDeserializerEvent): void;
}

const workerScope = globalThis as unknown as StorageDeserializerWorkerScope;

workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({
      kind: 'done',
      system: parseSystem(JSON.parse(event.data.serialized)),
    });
  } catch (error) {
    workerScope.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Stored document reconstruction failed.',
    });
  }
};
