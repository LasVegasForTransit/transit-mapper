export interface SettledSourceDataEvent {
  sourceId: string;
  sourceDataType: string;
  isSourceLoaded: boolean;
}

export type SourceDataListener = (event: SettledSourceDataEvent) => void;
export type SourceLoadingListener = (sourceId: string) => void;
export type RenderListener = () => void;

export interface SourceMutationSettlementHost {
  /** Observe loading of the underlying source data, excluding tile requests. */
  onSourceLoading(listener: SourceLoadingListener): () => void;
  onSourceData(listener: SourceDataListener): () => void;
  onRender(listener: RenderListener): () => void;
  triggerRepaint(): void;
}

export interface SourceMutationSettlementOptions {
  host: SourceMutationSettlementHost;
  sourceId: string;
  mutate(): void;
  onSettled(): void;
  onFallback(): void;
  timeoutMs?: number;
}

const DEFAULT_SETTLEMENT_TIMEOUT_MS = 2_000;

/**
 * Keeps the gesture preview in place until a source mutation has reached a
 * painted frame. Source-loaded alone is too early: removing the preview at
 * that point can expose one frame of the old committed geometry.
 */
export function settleSourceMutationAfterRender({
  host,
  sourceId,
  mutate,
  onSettled,
  onFallback,
  timeoutMs = DEFAULT_SETTLEMENT_TIMEOUT_MS,
}: SourceMutationSettlementOptions): () => void {
  let finished = false;
  let sourceRevision = 0;
  let stopSourceLoading: (() => void) | undefined;
  let stopSourceData: (() => void) | undefined;
  let stopRender: (() => void) | undefined;
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;

  const cleanup = () => {
    if (timeout !== undefined) {
      globalThis.clearTimeout(timeout);
      timeout = undefined;
    }
    stopSourceLoading?.();
    stopSourceLoading = undefined;
    stopSourceData?.();
    stopSourceData = undefined;
    stopRender?.();
    stopRender = undefined;
  };

  const finish = (callback: () => void) => {
    if (finished) return;
    finished = true;
    cleanup();
    callback();
  };

  // `mutate` may defer its actual setData/updateData call to the next frame.
  // Arm settlement only after MapLibre announces that mutation, so a late
  // loaded event from the superseded source cannot release the preview early.
  stopSourceLoading = host.onSourceLoading((loadingSourceId) => {
    if (loadingSourceId !== sourceId) return;
    sourceRevision++;
    stopRender?.();
    stopRender = undefined;
  });

  stopSourceData = host.onSourceData((event) => {
    if (
      event.sourceId !== sourceId ||
      event.sourceDataType !== 'content' ||
      !event.isSourceLoaded ||
      sourceRevision === 0
    ) {
      return;
    }

    const loadedRevision = sourceRevision;
    stopRender?.();
    stopRender = host.onRender(() => {
      if (loadedRevision !== sourceRevision) return;
      finish(onSettled);
    });
    host.triggerRepaint();
  });
  timeout = globalThis.setTimeout(() => finish(onFallback), timeoutMs);

  try {
    mutate();
  } catch {
    finish(onFallback);
  }

  return () => {
    if (finished) return;
    finished = true;
    cleanup();
  };
}
