import { previewSvg } from '@transitmapper/core/render/preview';
import { parseSystem } from '@transitmapper/core/model/serialize';
import type { PreviewWorkerEvent, PreviewWorkerRequest } from './previewWorkerProtocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<PreviewWorkerRequest>) => void) | null;
  postMessage(message: PreviewWorkerEvent): void;
}

const workerScope = globalThis as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  try {
    const system = parseSystem(JSON.parse(event.data.data));
    workerScope.postMessage({
      kind: 'done',
      markup: previewSvg(system, { displayWidth: event.data.displayWidth }),
    });
  } catch (error) {
    workerScope.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Preview rendering failed.',
    });
  }
};
