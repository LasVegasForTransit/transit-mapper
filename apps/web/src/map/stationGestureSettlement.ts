import {
  settleSourceMutationAfterRender,
  type SourceMutationSettlementHost,
} from './sourceMutationSettlement';

interface StationGestureSettlementMutation {
  mutate(): void;
  fallback(): void;
}

interface StationGestureSettlementRefresh {
  mutate(): void;
}

export interface StationGestureSettlementControllerOptions {
  host: SourceMutationSettlementHost;
  sourceId: string | (() => string);
  isGestureActive(): boolean;
  onRelease(): void;
  timeoutMs?: number;
}

export interface StationGestureSettlementController {
  beginDiff(mutation: StationGestureSettlementMutation): void;
  beginFull(refresh: StationGestureSettlementRefresh): void;
  ownsPreview(): boolean;
  releaseIfReady(): boolean;
  invalidate(): void;
  dispose(): void;
}

/**
 * Owns the short handoff from a gesture preview to committed station data.
 * A later gesture may reuse the still-visible preview; in that case the
 * controller records readiness but lets the new gesture decide when to release
 * the shared source and layer mask.
 */
export function createStationGestureSettlementController({
  host,
  sourceId,
  isGestureActive,
  onRelease,
  timeoutMs,
}: StationGestureSettlementControllerOptions): StationGestureSettlementController {
  let generation = 0;
  let pending = false;
  let ready = false;
  let disposed = false;
  let cancelPending: (() => void) | null = null;
  const currentSourceId = () => (typeof sourceId === 'string' ? sourceId : sourceId());

  const releaseIfReady = (): boolean => {
    if (!ready) return false;
    ready = false;
    onRelease();
    return true;
  };

  const markReady = (expectedGeneration: number) => {
    if (disposed || expectedGeneration !== generation) return;
    cancelPending = null;
    pending = false;
    ready = true;
    if (!isGestureActive()) releaseIfReady();
  };

  const beginFullRefresh = (mutate: () => void) => {
    if (disposed) return;
    const expectedGeneration = ++generation;
    cancelPending?.();
    pending = true;
    ready = false;
    cancelPending = settleSourceMutationAfterRender({
      host,
      sourceId: currentSourceId(),
      mutate,
      onSettled: () => markReady(expectedGeneration),
      // A bounded release prevents a failed MapLibre source from leaving the
      // editor permanently masked. The full refresh has already been issued.
      onFallback: () => markReady(expectedGeneration),
      timeoutMs,
    });
  };

  const cancelAndReset = () => {
    generation++;
    cancelPending?.();
    cancelPending = null;
    pending = false;
    ready = false;
  };

  return {
    beginDiff({ mutate, fallback }) {
      if (disposed) return;
      const expectedGeneration = ++generation;
      cancelPending?.();
      pending = true;
      ready = false;
      cancelPending = settleSourceMutationAfterRender({
        host,
        sourceId: currentSourceId(),
        mutate,
        onSettled: () => markReady(expectedGeneration),
        onFallback: () => {
          if (disposed || expectedGeneration !== generation) return;
          cancelPending = null;
          pending = false;
          // updateData can reject synchronously. Transfer on the next microtask
          // so this call's returned cleanup cannot overwrite the full refresh.
          queueMicrotask(() => {
            if (disposed || expectedGeneration !== generation) return;
            beginFullRefresh(fallback);
          });
        },
        timeoutMs,
      });
    },
    beginFull({ mutate }) {
      beginFullRefresh(mutate);
    },
    ownsPreview: () => pending || ready,
    releaseIfReady,
    invalidate: cancelAndReset,
    dispose() {
      disposed = true;
      cancelAndReset();
    },
  };
}
