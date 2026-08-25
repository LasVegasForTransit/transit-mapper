import { layoutDiagram, type DiagramLayoutResult } from '@transitmapper/core/model/diagramLayout';
import type {
  DiagramLayoutWorkerEvent,
  DiagramLayoutWorkerRequest,
} from './diagram-layout-worker-protocol';

interface DiagramLayoutWorkerScope {
  onmessage: ((event: MessageEvent<DiagramLayoutWorkerRequest>) => void) | null;
  postMessage(event: DiagramLayoutWorkerEvent): void;
}

const workerScope = globalThis as unknown as DiagramLayoutWorkerScope;
const layoutsByRevision = new Map<string, DiagramLayoutResult>();

function rememberLayout(revision: string, layout: DiagramLayoutResult): void {
  layoutsByRevision.delete(revision);
  layoutsByRevision.set(revision, layout);
  if (layoutsByRevision.size > 3) {
    const oldestRevision = layoutsByRevision.keys().next().value;
    if (oldestRevision) layoutsByRevision.delete(oldestRevision);
  }
}

workerScope.onmessage = (event) => {
  const request = event.data;
  try {
    const cached = layoutsByRevision.get(request.revision);
    const layout = cached ?? layoutDiagram(request.system);
    if (!cached) rememberLayout(request.revision, layout);
    workerScope.postMessage({
      kind: 'done',
      requestId: request.requestId,
      revision: request.revision,
      layout,
    });
  } catch (error) {
    workerScope.postMessage({
      kind: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'Diagram layout failed.',
    });
  }
};
