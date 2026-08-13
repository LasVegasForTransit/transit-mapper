import {
  settleSourceMutationAfterRender,
  type SourceMutationSettlementHost,
} from './sourceMutationSettlement';

interface StopGestureSettlementMutation {
  mutate: () => void;
  fallback: () => void;
}

interface StopGestureSettlementRefresh {
  mutate: () => void;
}

export interface StopGestureSettlementControllerOptions {
  host: SourceMutationSettlementHost;
  sourceId: string;
  isGestureActive: () => boolean;
  onRelease: () => void;
  timeoutMs?: number;
}

export interface StopGestureSettlementController {
  beginDiff: (mutation: StopGestureSettlementMutation) => void;
  beginFull: (refresh: StopGestureSettlementRefresh) => void;
  ownsPreview: () => boolean;
  releaseIfReady: () => boolean;
  invalidate: () => void;
  dispose: () => void;
}

interface SettlementState {
  generation: number;
  pending: boolean;
  ready: boolean;
  disposed: boolean;
  cancelPending: (() => void) | null;
}

interface SettlementContext {
  options: StopGestureSettlementControllerOptions;
  state: SettlementState;
  releaseIfReady: () => boolean;
}

function markReady(context: SettlementContext, expectedGeneration: number): void {
  const { options, state } = context;
  if (state.disposed || expectedGeneration !== state.generation) return;
  state.cancelPending = null;
  state.pending = false;
  state.ready = true;
  if (!options.isGestureActive()) context.releaseIfReady();
}

function beginFullRefresh(context: SettlementContext, mutate: () => void): void {
  const { options, state } = context;
  if (state.disposed) return;
  const expectedGeneration = ++state.generation;
  state.cancelPending?.();
  state.pending = true;
  state.ready = false;
  state.cancelPending = settleSourceMutationAfterRender({
    host: options.host,
    sourceId: options.sourceId,
    mutate,
    onSettled: () => markReady(context, expectedGeneration),
    // A bounded release prevents a failed MapLibre source from leaving the
    // editor permanently masked. The full refresh has already been issued.
    onFallback: () => markReady(context, expectedGeneration),
    timeoutMs: options.timeoutMs,
  });
}

function beginDiffMutation(
  context: SettlementContext,
  { mutate, fallback }: StopGestureSettlementMutation,
): void {
  const { options, state } = context;
  if (state.disposed) return;
  const expectedGeneration = ++state.generation;
  state.cancelPending?.();
  state.pending = true;
  state.ready = false;
  state.cancelPending = settleSourceMutationAfterRender({
    host: options.host,
    sourceId: options.sourceId,
    mutate,
    onSettled: () => markReady(context, expectedGeneration),
    onFallback: () => {
      if (state.disposed || expectedGeneration !== state.generation) return;
      state.cancelPending = null;
      state.pending = false;
      // updateData can reject synchronously. Transfer on the next microtask so
      // this call's returned cleanup cannot overwrite the full refresh.
      queueMicrotask(() => {
        if (state.disposed || expectedGeneration !== state.generation) return;
        beginFullRefresh(context, fallback);
      });
    },
    timeoutMs: options.timeoutMs,
  });
}

/**
 * Owns the short handoff from a gesture preview to committed stop data.
 * A later gesture may reuse the still-visible preview; in that case the
 * controller records readiness but lets the new gesture decide when to release
 * the shared source and layer mask.
 */
export function createStopGestureSettlementController(
  options: StopGestureSettlementControllerOptions,
): StopGestureSettlementController {
  const state: SettlementState = {
    generation: 0,
    pending: false,
    ready: false,
    disposed: false,
    cancelPending: null,
  };
  const releaseIfReady = (): boolean => {
    if (!state.ready) return false;
    state.ready = false;
    options.onRelease();
    return true;
  };
  const context: SettlementContext = { options, state, releaseIfReady };
  return {
    beginDiff: (mutation) => beginDiffMutation(context, mutation),
    beginFull: ({ mutate }) => beginFullRefresh(context, mutate),
    ownsPreview: () => state.pending || state.ready,
    releaseIfReady,
    invalidate() {
      state.generation++;
      state.cancelPending?.();
      state.cancelPending = null;
      state.pending = false;
      state.ready = false;
    },
    dispose() {
      state.disposed = true;
      state.generation++;
      state.cancelPending?.();
      state.cancelPending = null;
      state.pending = false;
      state.ready = false;
    },
  };
}
