/**
 * Lifecycle client for the CPU-only feature projector.
 *
 * Request IDs, rather than timing, decide which reply belongs to the current
 * editor generation. A canceled request may finish in the worker, but its
 * detached result can never publish a MapLibre source or replace an accepted
 * scene on the main thread.
 */
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import type {
  PatternOverlayFeatures,
  PatternOverlayProjectionInput,
} from '../projection/pattern-overlay-projection';
import type {
  FeatureProjectionRequestFacts,
  FeatureProjectionWorkerEvent,
  FeatureProjectionWorkerInput,
  FeatureProjectionWorkerRequest,
  PatternOverlayWorkerInput,
  ProjectionSystemCarriage,
  WorkerRenderView,
} from './feature-projection-worker-protocol';
import type { RetainedSystemSlot } from './retained-projection-systems';
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
  readonly workerFactory?: () => FeatureProjectionWorker;
}

export interface FeatureProjectionResult {
  readonly features: CompletedFeatureProjection['features'];
  readonly counts: CompletedFeatureProjection['counts'];
}

/** Callers hand over documents, not carriage. Which of them actually crosses
 * the boundary is the client's business, because only the client knows what
 * the live worker already holds. */
export interface FeatureProjectionClientInput extends FeatureProjectionRequestFacts {
  readonly system: TransitSystem;
  readonly diagramSystem?: TransitSystem;
  readonly view: RenderViewOptions;
}

export type PatternOverlayClientInput = Omit<PatternOverlayProjectionInput, 'view'> & {
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

/** The editor alone requests exact operational geometry. Keeping this
 * capability separate preserves the committed-scene client's Line-only
 * contract for viewers, exports, and renderer tests. */
export interface PatternOverlayProjectionClient {
  projectPatternOverlay(
    input: PatternOverlayClientInput,
    signal?: AbortSignal,
  ): Promise<PatternOverlayFeatures>;
}

type PendingProjection = PendingWorkerRequest<FeatureProjectionResult>;
type PendingPatternOverlayProjection = PendingWorkerRequest<PatternOverlayFeatures>;

function defaultWorkerFactory(): FeatureProjectionWorker {
  return new Worker(new URL('./feature-projection-worker-entry.js', import.meta.url), {
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

/** What the client believes the live worker holds, one entry per slot. */
type RetainedSystems = Map<RetainedSystemSlot, TransitSystem>;

/** Reference equality, never `updatedAt`: the editor store rebuilds the System
 * object on every mutation, while `updatedAt` is `Date.now()` and two edits in
 * one millisecond share it. */
function carriageFor(
  retained: RetainedSystems,
  system: TransitSystem,
  slot: RetainedSystemSlot,
): ProjectionSystemCarriage {
  return retained.get(slot) === system ? { kind: 'retained' } : { kind: 'sent', system };
}

function workerInput(
  retained: RetainedSystems,
  input: FeatureProjectionClientInput,
): FeatureProjectionWorkerInput {
  // Prepared snapshots hold main-thread map adapters. Their `get` methods are
  // not structured-clone data, so the worker must keep its own projection
  // indexes until a serializable prepared-snapshot format exists.
  const {
    preparedSnapshot: _preparedSnapshot,
    system,
    diagramSystem,
    view,
    ...workerSafeInput
  } = input;
  return {
    ...workerSafeInput,
    system: carriageFor(retained, system, 'system'),
    diagramSystem: diagramSystem ? carriageFor(retained, diagramSystem, 'diagramSystem') : null,
    view: workerView(view),
  };
}

function patternOverlayWorkerInput(
  retained: RetainedSystems,
  input: PatternOverlayClientInput,
): PatternOverlayWorkerInput {
  const { system, view, ...workerSafeInput } = input;
  return {
    ...workerSafeInput,
    system: carriageFor(retained, system, 'system'),
    view: workerView(view),
  };
}

/**
 * The persistent worker owns only projection-local caches, hysteresis, and
 * the documents this client has sent it. It is intentionally not a general
 * renderer service: source mutation, camera movement, layer visibility, and
 * hit ownership all stay in the live MapLibre renderer where they can be
 * transacted together.
 *
 * This client is the only thing that creates a worker, so it is also the only
 * thing that can say what one holds. It never asks: `retained` is written when
 * a message leaves and cleared whenever the worker behind it changes.
 */
export class FeatureProjectionWorkerClient
  implements FeatureProjectionClient, PatternOverlayProjectionClient
{
  private readonly workerFactory: () => FeatureProjectionWorker;
  private worker: FeatureProjectionWorker;
  private readonly pending = new Map<number, PendingProjection>();
  private readonly pendingPatternOverlays = new Map<number, PendingPatternOverlayProjection>();
  private readonly retained: RetainedSystems = new Map();
  private nextRequestId = 1;
  private disposed = false;

  constructor(options: FeatureProjectionWorkerOptions = {}) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.worker = this.createWorker();
  }

  private createWorker(): FeatureProjectionWorker {
    // A worker realm starts empty. Forgetting here rather than at each call
    // site is what stops the abort path from naming a retained System that
    // the replacement was never sent.
    this.retained.clear();
    const worker = this.workerFactory();
    worker.onmessage = (event) => this.handleMessage(event.data);
    worker.onerror = (event) =>
      this.failPending(new Error(event.message || 'Feature Worker failed.'));
    return worker;
  }

  /** Called only after `postMessage` returns. It throws on a value it cannot
   * clone, and the worker holds nothing new when it does. A carriage that
   * names the retained System leaves the slot alone, and so does a request
   * with no schematic snapshot: the worker keeps the one it already has. */
  private retainSent(slot: RetainedSystemSlot, carriage: ProjectionSystemCarriage | null): void {
    if (carriage?.kind === 'sent') this.retained.set(slot, carriage.system);
  }

  project(
    input: FeatureProjectionClientInput,
    signal?: AbortSignal,
  ): Promise<FeatureProjectionResult> {
    if (this.disposed) return Promise.reject(new Error('Feature projection Worker is disposed.'));
    if (signal?.aborted) return Promise.reject(projectionAbortedError());
    const requestId = this.nextRequestId++;
    return new Promise<FeatureProjectionResult>((resolve, reject) => {
      const abort = () => this.replaceWorker(projectionAbortedError());
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, {
        resolve,
        reject,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      });
      const sent = workerInput(this.retained, input);
      try {
        this.worker.postMessage({ kind: 'project', requestId, input: sent });
        this.retainSent('system', sent.system);
        this.retainSent('diagramSystem', sent.diagramSystem);
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

  projectPatternOverlay(
    input: PatternOverlayClientInput,
    signal?: AbortSignal,
  ): Promise<PatternOverlayFeatures> {
    if (this.disposed) return Promise.reject(new Error('Feature projection Worker is disposed.'));
    if (signal?.aborted) return Promise.reject(projectionAbortedError());
    const requestId = this.nextRequestId++;
    return new Promise<PatternOverlayFeatures>((resolve, reject) => {
      const abort = () => this.replaceWorker(projectionAbortedError());
      signal?.addEventListener('abort', abort, { once: true });
      this.pendingPatternOverlays.set(requestId, {
        resolve,
        reject,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      });
      const sent = patternOverlayWorkerInput(this.retained, input);
      try {
        this.worker.postMessage({ kind: 'project-pattern-overlay', requestId, input: sent });
        this.retainSent('system', sent.system);
      } catch (error) {
        this.rejectRequest(
          requestId,
          error instanceof Error
            ? error
            : new Error('Could not send Pattern overlay projection to Worker.'),
        );
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.retained.clear();
    this.failPending(new Error('Feature projection Worker is disposed.'));
    this.worker.terminate();
  }

  private handleMessage(event: FeatureProjectionWorkerEvent): void {
    if (event.kind === 'done') {
      takePendingWorkerRequest(this.pending, event.requestId)?.resolve({
        features: event.features,
        counts: event.counts,
      });
      return;
    }
    if (event.kind === 'pattern-overlay-done') {
      takePendingWorkerRequest(this.pendingPatternOverlays, event.requestId)?.resolve(
        event.overlay,
      );
      return;
    }
    const error = new Error(event.message);
    this.rejectRequest(event.requestId, error);
  }

  private rejectRequest(requestId: number, error: Error): void {
    rejectPendingWorkerRequest(this.pending, requestId, error);
    rejectPendingWorkerRequest(this.pendingPatternOverlays, requestId, error);
  }

  private failPending(error: Error): void {
    rejectAllPendingWorkerRequests(this.pending, error);
    rejectAllPendingWorkerRequests(this.pendingPatternOverlays, error);
  }

  private replaceWorker(error: Error): void {
    if (this.disposed || this.pending.size === 0) return;
    const previous = this.worker;
    previous.onmessage = null;
    previous.onerror = null;
    previous.terminate();
    this.failPending(error);
    this.worker = this.createWorker();
  }
}

export function createFeatureProjectionWorker(
  options?: FeatureProjectionWorkerOptions,
): FeatureProjectionWorkerClient {
  return new FeatureProjectionWorkerClient(options);
}
