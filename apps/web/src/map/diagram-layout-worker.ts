import type { DiagramLayoutResult } from '@transitmapper/core/model/diagramLayout';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type {
  DiagramLayoutWorkerEvent,
  DiagramLayoutWorkerRequest,
} from './diagram-layout-worker-protocol';
import {
  rejectAllPendingWorkerRequests,
  rejectPendingWorkerRequest,
  takePendingWorkerRequest,
  type PendingWorkerRequest,
} from './worker-request-lifecycle';

export interface DiagramLayoutWorker {
  onmessage: ((event: MessageEvent<DiagramLayoutWorkerEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(request: DiagramLayoutWorkerRequest): void;
  terminate(): void;
}

export interface DiagramLayoutWorkerOptions {
  workerFactory?(): DiagramLayoutWorker;
}

type PendingLayout = PendingWorkerRequest<DiagramLayoutResult>;

function defaultWorkerFactory(): DiagramLayoutWorker {
  return new Worker(new URL('./diagram-layout-worker-entry.ts', import.meta.url), {
    type: 'module',
    name: 'transitmapper-diagram-layout',
  });
}

function abortedLayoutError(): DOMException {
  return new DOMException('Diagram layout was superseded.', 'AbortError');
}

/**
 * Persistent browser boundary for the pure schematic solver.
 *
 * The worker isolates the CPU-heavy pure solver. This client only owns request
 * identity and cancellation: it never decides a layout or mutates a map, so
 * an old reply cannot replace a newer document.
 */
export class DiagramLayoutWorkerClient {
  private readonly worker: DiagramLayoutWorker;
  private readonly pending = new Map<number, PendingLayout>();
  /** A bounded history is enough for repeat camera work and one undo/redo
   * transition without retaining every layout a long editing session creates. */
  private readonly completedByRevision = new Map<string, DiagramLayoutResult>();
  private nextRequestId = 1;
  private disposed = false;

  constructor(options: DiagramLayoutWorkerOptions = {}) {
    this.worker = (options.workerFactory ?? defaultWorkerFactory)();
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) =>
      this.failPending(new Error(event.message || 'Diagram Worker failed.'));
  }

  layout(
    system: TransitSystem,
    revision: string,
    signal?: AbortSignal,
  ): Promise<DiagramLayoutResult> {
    if (this.disposed) return Promise.reject(new Error('Diagram layout Worker is disposed.'));
    if (signal?.aborted) return Promise.reject(abortedLayoutError());
    const completed = this.completedByRevision.get(revision);
    if (completed) return Promise.resolve(completed);
    const requestId = this.nextRequestId++;
    return new Promise<DiagramLayoutResult>((resolve, reject) => {
      const abort = () => this.rejectRequest(requestId, abortedLayoutError());
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, {
        resolve,
        reject,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      });
      try {
        this.worker.postMessage({ kind: 'layout', requestId, revision, system });
      } catch (error) {
        this.rejectRequest(
          requestId,
          error instanceof Error ? error : new Error('Could not send Diagram layout to Worker.'),
        );
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failPending(new Error('Diagram layout Worker is disposed.'));
    this.worker.terminate();
  }

  private handleMessage(event: DiagramLayoutWorkerEvent): void {
    const pending = takePendingWorkerRequest(this.pending, event.requestId);
    if (!pending) return;
    if (event.kind === 'done') {
      this.rememberCompleted(event.revision, event.layout);
      pending.resolve(event.layout);
    } else pending.reject(new Error(event.message));
  }

  private rejectRequest(requestId: number, error: Error): void {
    rejectPendingWorkerRequest(this.pending, requestId, error);
  }

  private failPending(error: Error): void {
    rejectAllPendingWorkerRequests(this.pending, error);
  }

  private rememberCompleted(revision: string, layout: DiagramLayoutResult): void {
    this.completedByRevision.delete(revision);
    this.completedByRevision.set(revision, layout);
    if (this.completedByRevision.size > 3) {
      const oldestRevision = this.completedByRevision.keys().next().value;
      if (oldestRevision) this.completedByRevision.delete(oldestRevision);
    }
  }
}

export function createDiagramLayoutWorker(
  options?: DiagramLayoutWorkerOptions,
): DiagramLayoutWorkerClient {
  return new DiagramLayoutWorkerClient(options);
}
