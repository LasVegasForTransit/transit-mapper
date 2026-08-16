/**
 * Lifecycle client for the CPU-only feature projector.
 *
 * Request IDs, rather than timing, decide which reply belongs to the current
 * editor generation. A canceled request may finish in the worker, but its
 * detached result can never publish a MapLibre source or replace an accepted
 * scene on the main thread.
 */
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import type {
  FeatureProjectionWorkerEvent,
  FeatureProjectionWorkerInput,
  FeatureProjectionWorkerRequest,
  WorkerRenderView,
} from './feature-projection-worker-protocol';
import {
  rejectAllPendingWorkerRequests,
  rejectPendingWorkerRequest,
  takePendingWorkerRequest,
  type PendingWorkerRequest,
} from './worker-request-lifecycle';

type CompletedFeatureProjection = Extract<FeatureProjectionWorkerEvent, { kind: 'done' }>;

export interface FeatureProjectionWorker {
  onmessage: ((event: MessageEvent<FeatureProjectionWorkerEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(request: FeatureProjectionWorkerRequest): void;
  terminate(): void;
}

export interface FeatureProjectionWorkerOptions {
  workerFactory?(): FeatureProjectionWorker;
}

export interface FeatureProjectionResult {
  readonly features: CompletedFeatureProjection['features'];
  readonly counts: CompletedFeatureProjection['counts'];
}

export type FeatureProjectionClientInput = Omit<FeatureProjectionWorkerInput, 'view'> & {
  readonly view: RenderViewOptions;
};

/** The only capability the live renderer needs from the projection Worker.
 * Keeping this interface separate from the concrete Worker client lets the
 * publication boundary be tested without fabricating Worker internals. */
export interface FeatureProjectionClient {
  project(
    input: FeatureProjectionClientInput,
    signal?: AbortSignal,
  ): Promise<FeatureProjectionResult>;
  dispose(): void;
}

type PendingProjection = PendingWorkerRequest<FeatureProjectionResult>;

function defaultWorkerFactory(): FeatureProjectionWorker {
  return new Worker(new URL('./feature-projection-worker-entry.ts', import.meta.url), {
    type: 'module',
    name: 'transitmapper-feature-projection',
  });
}

function projectionAbortedError(): DOMException {
  return new DOMException('Feature projection was superseded.', 'AbortError');
}

function workerView(view: RenderViewOptions): WorkerRenderView {
  const { tierStateResolver: _tierStateResolver, ...serializableView } = view;
  return serializableView;
}

function workerInput(input: FeatureProjectionClientInput): FeatureProjectionWorkerInput {
  // Prepared snapshots hold main-thread map adapters. Their `get` methods are
  // not structured-clone data, so the worker must keep its own projection
  // indexes until a serializable prepared-snapshot format exists.
  const { preparedSnapshot: _preparedSnapshot, view, ...workerSafeInput } = input;
  return { ...workerSafeInput, view: workerView(view) };
}

/**
 * The persistent worker owns only projection-local caches and hysteresis.
 * It is intentionally not a general renderer service: source mutation,
 * camera movement, layer visibility, and hit ownership all stay in the live
 * MapLibre renderer where they can be transacted together.
 */
export class FeatureProjectionWorkerClient implements FeatureProjectionClient {
  private readonly worker: FeatureProjectionWorker;
  private readonly pending = new Map<number, PendingProjection>();
  private nextRequestId = 1;
  private disposed = false;

  constructor(options: FeatureProjectionWorkerOptions = {}) {
    this.worker = (options.workerFactory ?? defaultWorkerFactory)();
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) =>
      this.failPending(new Error(event.message || 'Feature Worker failed.'));
  }

  project(
    input: FeatureProjectionClientInput,
    signal?: AbortSignal,
  ): Promise<FeatureProjectionResult> {
    if (this.disposed) return Promise.reject(new Error('Feature projection Worker is disposed.'));
    if (signal?.aborted) return Promise.reject(projectionAbortedError());
    const requestId = this.nextRequestId++;
    return new Promise<FeatureProjectionResult>((resolve, reject) => {
      const abort = () => this.rejectRequest(requestId, projectionAbortedError());
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, {
        resolve,
        reject,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      });
      try {
        this.worker.postMessage({ kind: 'project', requestId, input: workerInput(input) });
      } catch (error) {
        this.rejectRequest(
          requestId,
          error instanceof Error
            ? error
            : new Error('Could not send feature projection to Worker.'),
        );
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failPending(new Error('Feature projection Worker is disposed.'));
    this.worker.terminate();
  }

  private handleMessage(event: FeatureProjectionWorkerEvent): void {
    const pending = takePendingWorkerRequest(this.pending, event.requestId);
    if (!pending) return;
    if (event.kind === 'done') pending.resolve({ features: event.features, counts: event.counts });
    else pending.reject(new Error(event.message));
  }

  private rejectRequest(requestId: number, error: Error): void {
    rejectPendingWorkerRequest(this.pending, requestId, error);
  }

  private failPending(error: Error): void {
    rejectAllPendingWorkerRequests(this.pending, error);
  }
}

export function createFeatureProjectionWorker(
  options?: FeatureProjectionWorkerOptions,
): FeatureProjectionWorkerClient {
  return new FeatureProjectionWorkerClient(options);
}
