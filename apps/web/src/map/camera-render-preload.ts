/**
 * Camera-only renderer policy: predict a conservative candidate envelope,
 * decide whether the accepted scene still covers the current presentation,
 * and coalesce invalidating camera motion. This module never builds geometry.
 */
import type { RenderCandidateEnvelope } from '@transitmapper/core/render/render-candidate-envelope';
import type { RenderPresentation } from '@transitmapper/core/render/render-presentation';
import { renderViewportTransitionMarginDegrees } from '@transitmapper/core/render/render-viewport-margin';

export interface CameraRenderPreloadOptions {
  /** Conservative cold-settlement horizon before measured generations exist. */
  readonly initialSettlementMs?: number;
}

export interface CameraRenderPreloadToken {
  readonly owner: object;
  readonly center: readonly [number, number];
}

export interface CameraPixelVector {
  readonly x: number;
  readonly y: number;
}

export interface PreparedCameraRenderPreload {
  readonly candidateEnvelope: RenderCandidateEnvelope;
  readonly token: CameraRenderPreloadToken;
  readonly outstandingDisplacementPx: CameraPixelVector;
  readonly velocityPxPerMs: CameraPixelVector;
  readonly settlementHorizonMs: number;
}

export interface CameraRenderPreloadController {
  observe(presentation: RenderPresentation, nowMs: number): void;
  prepare(presentation: RenderPresentation, nowMs: number): PreparedCameraRenderPreload;
  /** Accept only after this exact camera scene has reached the live source
   * boundary. Displacement after the submitted token remains outstanding. */
  accept(token: CameraRenderPreloadToken, settlementLatencyMs: number): void;
  reset(): void;
}

export interface CommittedCameraCoverage {
  readonly presentation: RenderPresentation;
  readonly candidateEnvelope: RenderCandidateEnvelope;
}

export interface CommittedCameraRefreshState {
  readonly committed: CommittedCameraCoverage | null;
  readonly current: RenderPresentation;
  readonly renderedSystemId: string | null;
  readonly currentSystemId: string;
  readonly rendererHealthy: boolean;
  readonly projectionActive: boolean;
}

export interface PresentationRefreshSchedulerOptions {
  intervalMs: number;
  now(): number;
  scheduleFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  scheduleTimer(callback: () => void, delayMs: number): number;
  cancelTimer(handle: number): void;
  /** Runs synchronously for every camera invalidation, even when projection is
   * coalesced behind an existing frame or trailing timer. */
  onRequest?(): void;
  refresh(): Promise<void> | void;
}

export interface PresentationRefreshScheduler {
  request(): void;
  /** Resolves after every currently scheduled frame/timer and asynchronous
   * refresh has finished. Used by deterministic evidence and export seams. */
  whenSettled(): Promise<void>;
  dispose(): void;
}

interface PresentationRefreshTracker {
  clearError(): void;
  notify(): void;
  run(refresh: () => Promise<void> | void): void;
  whenSettled(hasScheduledWork: () => boolean): Promise<void>;
}

interface CameraSample {
  readonly center: readonly [number, number];
  readonly presentation: RenderPresentation;
  readonly nowMs: number;
}

const MIN_SETTLEMENT_MS = 80;
const MAX_SETTLEMENT_MS = 1_000;
const DEFAULT_SETTLEMENT_MS = 400;

function center(presentation: RenderPresentation): readonly [number, number] {
  return [
    (presentation.bounds.southwest[0] + presentation.bounds.northeast[0]) / 2,
    (presentation.bounds.southwest[1] + presentation.bounds.northeast[1]) / 2,
  ];
}

function longitudeDelta(from: number, to: number): number {
  const direct = to - from;
  if (direct > 180) return direct - 360;
  if (direct < -180) return direct + 360;
  return direct;
}

function displacementPx(
  from: readonly [number, number],
  to: readonly [number, number],
  presentation: RenderPresentation,
): CameraPixelVector {
  const longitudePerPixel =
    Math.abs(presentation.bounds.northeast[0] - presentation.bounds.southwest[0]) /
    presentation.viewportWidthPx;
  const latitudePerPixel =
    Math.abs(presentation.bounds.northeast[1] - presentation.bounds.southwest[1]) /
    presentation.viewportHeightPx;
  if (longitudePerPixel <= 0 || latitudePerPixel <= 0) return { x: 0, y: 0 };
  return {
    x: longitudeDelta(from[0], to[0]) / longitudePerPixel,
    y: (to[1] - from[1]) / latitudePerPixel,
  };
}

function shiftedEnvelope(
  presentation: RenderPresentation,
  predicted: CameraPixelVector,
): RenderCandidateEnvelope {
  const longitudePerPixel =
    (presentation.bounds.northeast[0] - presentation.bounds.southwest[0]) /
    presentation.viewportWidthPx;
  const latitudePerPixel =
    (presentation.bounds.northeast[1] - presentation.bounds.southwest[1]) /
    presentation.viewportHeightPx;
  const longitudeShift = predicted.x * longitudePerPixel;
  const latitudeShift = predicted.y * latitudePerPixel;
  return {
    bounds: {
      southwest: [
        presentation.bounds.southwest[0] + Math.min(0, longitudeShift),
        presentation.bounds.southwest[1] + Math.min(0, latitudeShift),
      ],
      northeast: [
        presentation.bounds.northeast[0] + Math.max(0, longitudeShift),
        presentation.bounds.northeast[1] + Math.max(0, latitudeShift),
      ],
    },
  };
}

function validateTime(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative duration.`);
  }
}

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createPresentationRefreshTracker(): PresentationRefreshTracker {
  const active = new Set<Promise<void>>();
  const waiters = new Set<() => void>();
  let lastError: Error | null = null;
  const notify = () => {
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  return {
    clearError: () => {
      lastError = null;
    },
    notify,
    run(refresh) {
      let result: Promise<void> | void;
      try {
        result = refresh();
      } catch (error) {
        lastError = errorFrom(error);
        notify();
        return;
      }
      const promise = Promise.resolve(result);
      active.add(promise);
      promise.then(
        () => {
          active.delete(promise);
          notify();
        },
        (error: unknown) => {
          active.delete(promise);
          lastError = errorFrom(error);
          notify();
        },
      );
      notify();
    },
    async whenSettled(hasScheduledWork) {
      while (hasScheduledWork() || active.size > 0) {
        await new Promise<void>((resolve) => {
          waiters.add(resolve);
        });
      }
      if (lastError) throw lastError;
    },
  };
}

class CameraRenderPreloadControllerImplementation implements CameraRenderPreloadController {
  private readonly owner = {};
  private readonly initialSettlementMs: number;
  private settlementHorizonMs: number;
  private lastSample: CameraSample | null = null;
  private acceptedCenter: readonly [number, number] | null = null;
  private velocityPxPerMs: CameraPixelVector = { x: 0, y: 0 };

  constructor(options: CameraRenderPreloadOptions) {
    this.initialSettlementMs = options.initialSettlementMs ?? DEFAULT_SETTLEMENT_MS;
    validateTime(this.initialSettlementMs, 'Initial renderer settlement');
    this.settlementHorizonMs = this.initialSettlementMs;
  }

  observe(presentation: RenderPresentation, nowMs: number): void {
    validateTime(nowMs, 'Camera sample time');
    const next: CameraSample = { center: center(presentation), presentation, nowMs };
    const previous = this.lastSample;
    if (previous && nowMs > previous.nowMs) {
      const travel = displacementPx(previous.center, next.center, presentation);
      const durationMs = nowMs - previous.nowMs;
      this.velocityPxPerMs = { x: travel.x / durationMs, y: travel.y / durationMs };
    }
    this.lastSample = next;
  }

  prepare(presentation: RenderPresentation, nowMs: number): PreparedCameraRenderPreload {
    this.observe(presentation, nowMs);
    const currentCenter = center(presentation);
    const outstandingDisplacementPx = displacementPx(
      this.acceptedCenter ?? currentCenter,
      currentCenter,
      presentation,
    );
    const predicted = {
      x: outstandingDisplacementPx.x + this.velocityPxPerMs.x * this.settlementHorizonMs,
      y: outstandingDisplacementPx.y + this.velocityPxPerMs.y * this.settlementHorizonMs,
    };
    return {
      candidateEnvelope: shiftedEnvelope(presentation, predicted),
      token: { owner: this.owner, center: currentCenter },
      outstandingDisplacementPx,
      velocityPxPerMs: this.velocityPxPerMs,
      settlementHorizonMs: this.settlementHorizonMs,
    };
  }

  accept(token: CameraRenderPreloadToken, settlementLatencyMs: number): void {
    if (token.owner !== this.owner) {
      throw new Error('Camera preload token belongs to another controller.');
    }
    validateTime(settlementLatencyMs, 'Renderer settlement latency');
    this.acceptedCenter = token.center;
    this.settlementHorizonMs = Math.max(
      MIN_SETTLEMENT_MS,
      Math.min(
        MAX_SETTLEMENT_MS,
        Math.max(settlementLatencyMs * 1.25, this.settlementHorizonMs * 0.75),
      ),
    );
  }

  reset(): void {
    this.lastSample = null;
    this.acceptedCenter = null;
    this.velocityPxPerMs = { x: 0, y: 0 };
    this.settlementHorizonMs = this.initialSettlementMs;
  }
}

/** True when one committed directional candidate query plus the normal static
 * transition guard still encloses every edge of a later visible viewport. */
export function candidateEnvelopeCoversViewport(
  committedPresentation: RenderPresentation,
  envelope: RenderCandidateEnvelope,
  visible: RenderPresentation,
): boolean {
  const margin = renderViewportTransitionMarginDegrees(committedPresentation);
  return (
    visible.bounds.southwest[0] >= envelope.bounds.southwest[0] - margin &&
    visible.bounds.southwest[1] >= envelope.bounds.southwest[1] - margin &&
    visible.bounds.northeast[0] <= envelope.bounds.northeast[0] + margin &&
    visible.bounds.northeast[1] <= envelope.bounds.northeast[1] + margin
  );
}

function hasSameScreenScale(committed: RenderPresentation, current: RenderPresentation): boolean {
  return (
    committed.zoom === current.zoom &&
    committed.viewportWidthPx === current.viewportWidthPx &&
    committed.viewportHeightPx === current.viewportHeightPx &&
    committed.displayedWidthPx === current.displayedWidthPx &&
    committed.displayedHeightPx === current.displayedHeightPx &&
    committed.pixelRatio === current.pixelRatio
  );
}

/** A same-scale pan is already an exact MapLibre camera transform. Reproject
 * only when it can reveal geometry outside the accepted candidate envelope;
 * zoom, resize, display-scale, and DPR changes still recompute presentation. */
export function canReuseCommittedCameraScene(
  committed: CommittedCameraCoverage | null,
  current: RenderPresentation,
): boolean {
  return (
    committed !== null &&
    hasSameScreenScale(committed.presentation, current) &&
    candidateEnvelopeCoversViewport(committed.presentation, committed.candidateEnvelope, current)
  );
}

/** Camera transforms are already performed by MapLibre. Projection can be
 * skipped only while the accepted renderer revision is healthy, belongs to
 * this document, has no successor in flight, and still covers the viewport. */
export function canReuseCommittedCameraRefresh(state: CommittedCameraRefreshState): boolean {
  return (
    state.rendererHealthy &&
    !state.projectionActive &&
    state.renderedSystemId === state.currentSystemId &&
    canReuseCommittedCameraScene(state.committed, state.current)
  );
}

export function createCameraRenderPreloadController(
  options: CameraRenderPreloadOptions = {},
): CameraRenderPreloadController {
  return new CameraRenderPreloadControllerImplementation(options);
}

/** Keeps camera-driven projection responsive without rebuilding on every raw
 * zoom event. The leading frame prepares adjacent LOD geometry; one bounded
 * trailing refresh guarantees the settled viewport is exact. */
export function createPresentationRefreshScheduler(
  options: PresentationRefreshSchedulerOptions,
): PresentationRefreshScheduler {
  let disposed = false;
  let lastRefreshAt: number | null = null;
  let pendingFrame: number | null = null;
  let pendingTimer: number | null = null;
  const tracker = createPresentationRefreshTracker();

  const run = () => {
    pendingFrame = null;
    if (disposed) {
      tracker.notify();
      return;
    }
    lastRefreshAt = options.now();
    tracker.run(() => options.refresh());
  };

  const scheduleFrame = () => {
    if (pendingFrame !== null) return;
    pendingFrame = options.scheduleFrame(run);
  };

  const scheduleTrailing = (delayMs: number) => {
    if (pendingTimer !== null) return;
    pendingTimer = options.scheduleTimer(() => {
      pendingTimer = null;
      scheduleFrame();
    }, delayMs);
  };

  return {
    request() {
      options.onRequest?.();
      if (disposed || pendingFrame !== null) return;
      tracker.clearError();
      if (lastRefreshAt === null) {
        scheduleFrame();
        return;
      }
      const remainingMs = options.intervalMs - (options.now() - lastRefreshAt);
      if (remainingMs <= 0) scheduleFrame();
      else scheduleTrailing(remainingMs);
    },
    whenSettled: () => tracker.whenSettled(() => pendingFrame !== null || pendingTimer !== null),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (pendingFrame !== null) options.cancelFrame(pendingFrame);
      if (pendingTimer !== null) options.cancelTimer(pendingTimer);
      pendingFrame = null;
      pendingTimer = null;
      tracker.notify();
    },
  };
}
