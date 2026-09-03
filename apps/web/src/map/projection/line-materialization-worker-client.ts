import type {
  LineMaterializationWorkerEvent,
  LineMaterializationWorkerInput,
  LineMaterializationWorkerRequest,
  LineMaterializationWorkerResult,
} from './line-materialization-worker-protocol';

export interface LineMaterializationWorker {
  onmessage: ((event: MessageEvent<LineMaterializationWorkerEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(request: LineMaterializationWorkerRequest): void;
  terminate(): void;
}

export interface LineMaterializationWorkerClientOptions {
  readonly workerFactory?: () => LineMaterializationWorker;
}

interface ActiveMaterialization {
  readonly resolve: (result: LineMaterializationWorkerResult) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal | undefined;
  readonly abort: () => void;
  readonly sessionId: string;
  readonly requestId: number;
}

const defaultWorkerFactory = (): LineMaterializationWorker => {
  return new Worker(new URL('./line-materialization-worker-entry.ts', import.meta.url), {
    type: 'module',
    name: 'transitmapper-line-materialization',
  });
};

function abortedError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('Line materialization was superseded.', 'AbortError');
}

/** This client keeps only transaction identity. The Worker owns all projection state. */
export class LineMaterializationWorkerClient {
  private readonly workerFactory: () => LineMaterializationWorker;
  private worker: LineMaterializationWorker | undefined;
  private active: ActiveMaterialization | undefined;
  private nextRequestId = 1;
  private nextSessionId = 1;
  private disposed = false;

  constructor(options: LineMaterializationWorkerClientOptions = {}) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
  }

  materialize(
    input: LineMaterializationWorkerInput,
    signal?: AbortSignal,
  ): Promise<LineMaterializationWorkerResult> {
    if (this.disposed) return Promise.reject(new Error('Line materialization Worker is disposed.'));
    if (signal?.aborted) return Promise.reject(abortedError(signal));
    this.abortActive(abortedError());
    const worker = this.getWorker();
    return new Promise((resolve, reject) => {
      const active: ActiveMaterialization = {
        resolve,
        reject,
        signal,
        abort: () => this.abortActive(abortedError(signal)),
        sessionId: `line-materialization-${this.nextSessionId++}`,
        requestId: this.nextRequestId++,
      };
      this.active = active;
      signal?.addEventListener('abort', active.abort, { once: true });
      this.post(worker, {
        kind: 'materialize',
        requestId: active.requestId,
        sessionId: active.sessionId,
        input,
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortActive(new Error('Line materialization Worker is disposed.'));
    this.worker?.terminate();
    this.worker = undefined;
  }

  private getWorker(): LineMaterializationWorker {
    if (this.worker !== undefined) return this.worker;
    const worker = this.workerFactory();
    worker.onmessage = (event) => this.handleMessage(event.data);
    worker.onerror = (event) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      worker.terminate();
      this.abortActive(new Error(event.message || 'Line Worker failed.'));
    };
    this.worker = worker;
    return worker;
  }

  private handleMessage(event: LineMaterializationWorkerEvent): void {
    const active = this.active;
    if (active?.requestId !== event.requestId || active.sessionId !== event.sessionId) {
      return;
    }
    if (event.kind === 'error') {
      this.failActive(new Error(event.message));
      return;
    }
    this.completeActive(event.result);
  }

  private post(worker: LineMaterializationWorker, request: LineMaterializationWorkerRequest): void {
    try {
      worker.postMessage(request);
    } catch (error) {
      this.failActive(
        error instanceof Error ? error : new Error('Could not send Line work to Worker.'),
      );
    }
  }

  private completeActive(result: LineMaterializationWorkerResult): void {
    const active = this.active;
    if (active === undefined) return;
    const released = this.release(active);
    this.active = undefined;
    active.signal?.removeEventListener('abort', active.abort);
    if (!released) this.resetWorker();
    active.resolve(result);
  }

  private failActive(error: Error): void {
    const active = this.active;
    if (active === undefined) return;
    const released = this.release(active);
    this.active = undefined;
    active.signal?.removeEventListener('abort', active.abort);
    if (!released) this.resetWorker();
    active.reject(error);
  }

  private abortActive(error: Error): void {
    const active = this.active;
    if (active === undefined) return;
    this.release(active);
    this.active = undefined;
    active.signal?.removeEventListener('abort', active.abort);
    this.worker?.terminate();
    this.worker = undefined;
    active.reject(error);
  }

  private release(active: ActiveMaterialization): boolean {
    const worker = this.worker;
    if (worker === undefined) return true;
    try {
      worker.postMessage({
        kind: 'release',
        requestId: active.requestId,
        sessionId: active.sessionId,
      });
      return true;
    } catch {
      return false;
    }
  }

  private resetWorker(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }
}
