import type { StorageSerializerEvent, StorageSerializerRequest } from './storageSerializerProtocol';

interface StorageSerializerWorkerScope {
  onmessage: ((event: MessageEvent<StorageSerializerRequest>) => void) | null;
  postMessage(message: StorageSerializerEvent): void;
}

const workerScope = globalThis as unknown as StorageSerializerWorkerScope;

workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({
      kind: 'done',
      serialized: JSON.stringify(event.data.system),
    });
  } catch (error) {
    workerScope.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Document serialization failed.',
    });
  }
};
