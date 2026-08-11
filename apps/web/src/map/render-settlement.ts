import type { GestureAffectedEntities } from './gestureProjection';

export interface RendererWorkLease {
  complete(): void;
  fail(error: unknown): void;
}

export interface RendererWorkSettlementTracker {
  /** Marks scheduled work before its frame or asynchronous generation starts. */
  begin(): RendererWorkLease;
  /** Deterministic capture barrier for every lease currently in flight. */
  whenSettled(): Promise<void>;
  dispose(): void;
}

interface SettlementWaiter {
  resolve(): void;
  reject(error: Error): void;
}

interface GesturePaintSettlementRequest {
  mutate: () => void;
}

export interface GestureRenderBoundaryHost {
  onRender(listener: () => void): () => void;
  triggerRepaint(): void;
}

export interface GesturePaintSettlementControllerOptions {
  /** Waits for the complete renderer generation and the following MapLibre
   * render boundary. `begin` invokes this only after `mutate` has scheduled
   * the committed refresh. */
  settlePaint: (signal: AbortSignal) => Promise<void>;
  isGestureActive: () => boolean;
  onRelease: () => void;
  /** Reports that exact settled paint was not reached. The lightweight
   * fallback remains visible; reporting must not throw into renderer state. */
  onUnsettled?: (error: Error) => void;
  timeoutMs?: number;
}

export interface GesturePaintSettlementController {
  begin(request: GesturePaintSettlementRequest): void;
  ownsPreview(): boolean;
  /** Failed fallbacks stay visible but must not indefinitely prevent theme or
   * style recovery. Only an active exact-paint handoff owns that lock. */
  blocksStyleSwitch(): boolean;
  releaseIfReady(): boolean;
  invalidate(): void;
  dispose(): void;
}

const DEFAULT_SETTLEMENT_TIMEOUT_MS = 2_000;

class GesturePaintSettlementTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Committed renderer paint did not settle within ${timeoutMs} ms.`);
    this.name = 'TimeoutError';
  }
}

function settlementError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Tracks renderer scheduling and asynchronous projection without coupling the
 * browser-free barrier to requestAnimationFrame or MapLibre. A replacement may
 * complete one lease while its successor remains active; capture releases only
 * when the complete chain becomes quiescent. */
export function createRendererWorkSettlementTracker(): RendererWorkSettlementTracker {
  const waiters = new Set<SettlementWaiter>();
  let activeCount = 0;
  let lastError: Error | null = null;
  let disposed = false;

  const notifyIfSettled = (): void => {
    if (activeCount > 0) return;
    for (const waiter of waiters) {
      if (lastError) waiter.reject(lastError);
      else waiter.resolve();
    }
    waiters.clear();
  };

  const begin = (): RendererWorkLease => {
    if (disposed) throw new Error('The renderer work settlement tracker is disposed.');
    lastError = null;
    activeCount += 1;
    let finished = false;
    const finish = (error?: unknown): void => {
      if (finished) return;
      finished = true;
      if (disposed) return;
      if (error !== undefined) lastError = settlementError(error);
      activeCount -= 1;
      notifyIfSettled();
    };
    return {
      complete: () => finish(),
      fail: (error) => finish(error),
    };
  };

  return {
    begin,
    whenSettled() {
      if (activeCount === 0) {
        return lastError ? Promise.reject(lastError) : Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        waiters.add({ resolve, reject });
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      activeCount = 0;
      lastError = null;
      notifyIfSettled();
    },
  };
}

/** Station previews have their own exact partial/full source handoff. Every
 * other direct-manipulation preview masks several renderer sources and must
 * therefore wait for the complete committed generation, not one arbitrarily
 * chosen representative source. */
export function gestureNeedsCommittedPaint(affected: GestureAffectedEntities): boolean {
  return (
    affected.wayIds.length > 0 ||
    affected.nodeIds.length > 0 ||
    affected.facilityIds.length > 0 ||
    affected.groupIds.length > 0
  );
}

/** Resolves on the next rendered frame rather than global MapLibre idle.
 * Unrelated animated sources can keep idle from firing indefinitely, while
 * their render cadence is itself sufficient evidence that the loaded
 * renderer revision has reached the compositor. */
export function waitForGestureRenderBoundary(
  host: GestureRenderBoundaryHost,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stopRender = () => {};
    const cleanup = () => {
      stopRender();
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error('Gesture paint settlement was superseded.'));
    };
    stopRender = host.onRender(() => {
      cleanup();
      resolve();
    });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else host.triggerRepaint();
  });
}

class GesturePaintSettlementControllerImplementation implements GesturePaintSettlementController {
  private generation = 0;
  private pending = false;
  private ready = false;
  private fallback = false;
  private disposed = false;
  private timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  private settlementAbort: AbortController | undefined;

  constructor(private readonly options: GesturePaintSettlementControllerOptions) {}

  begin(request: GesturePaintSettlementRequest): void {
    if (this.disposed) return;
    const expectedGeneration = ++this.generation;
    this.clearTimeout();
    this.settlementAbort?.abort();
    const abort = new AbortController();
    this.settlementAbort = abort;
    this.pending = true;
    this.ready = false;
    this.fallback = false;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_SETTLEMENT_TIMEOUT_MS;
    this.timeout = globalThis.setTimeout(() => {
      this.settlementAbort?.abort();
      this.markUnsettled(expectedGeneration, new GesturePaintSettlementTimeoutError(timeoutMs));
    }, timeoutMs);
    try {
      request.mutate();
      void this.options.settlePaint(abort.signal).then(
        () => this.markReady(expectedGeneration),
        (error: unknown) => this.markUnsettled(expectedGeneration, error),
      );
    } catch (error) {
      this.markUnsettled(expectedGeneration, error);
    }
  }

  ownsPreview(): boolean {
    return this.pending || this.ready || this.fallback;
  }

  blocksStyleSwitch(): boolean {
    return this.pending || this.ready;
  }

  releaseIfReady(): boolean {
    if (!this.ready || this.options.isGestureActive()) return false;
    this.ready = false;
    this.options.onRelease();
    return true;
  }

  invalidate(): void {
    this.generation++;
    this.clearTimeout();
    this.settlementAbort?.abort();
    this.settlementAbort = undefined;
    this.pending = false;
    this.ready = false;
    this.fallback = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidate();
  }

  private clearTimeout(): void {
    if (this.timeout === undefined) return;
    globalThis.clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  private markReady(expectedGeneration: number): void {
    if (this.disposed || expectedGeneration !== this.generation || !this.pending) return;
    this.clearTimeout();
    this.settlementAbort = undefined;
    this.pending = false;
    this.ready = true;
    this.fallback = false;
    this.releaseIfReady();
  }

  private markUnsettled(expectedGeneration: number, error: unknown): void {
    if (this.disposed || expectedGeneration !== this.generation || !this.pending) return;
    this.clearTimeout();
    this.settlementAbort = undefined;
    this.pending = false;
    this.ready = false;
    this.fallback = true;
    try {
      this.options.onUnsettled?.(settlementError(error));
    } catch {
      // Diagnostics must not clear truthful gesture feedback.
    }
  }
}

/** Owns the preview-to-committed-paint handoff for non-station gestures.
 * Starting a later handoff supersedes the older generation. Rejection and a
 * bounded timeout retain the lightweight fallback: exposing the prior settled
 * scene would falsely present a failed edit as committed. */
export function createGesturePaintSettlementController(
  options: GesturePaintSettlementControllerOptions,
): GesturePaintSettlementController {
  return new GesturePaintSettlementControllerImplementation(options);
}
