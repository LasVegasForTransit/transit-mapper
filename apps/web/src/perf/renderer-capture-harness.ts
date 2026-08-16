interface RendererCaptureCamera {
  center: [number, number];
  zoom: number;
}

interface RendererCaptureMap {
  once(event: 'idle', listener: () => void): void;
  jumpTo(camera: RendererCaptureCamera): unknown;
  triggerRepaint(): unknown;
}

export interface RendererCaptureHost {
  __rendererCaptureSetCamera?: (camera: RendererCaptureCamera) => Promise<void>;
  __rendererCaptureWhenSettled?: () => Promise<void>;
}

export interface RendererCaptureHarnessOptions {
  /** Resolves only after the latest camera-driven projection generation has
   * committed its complete scene. Source/layout settlement is awaited by the
   * following MapLibre idle barrier. */
  afterRendererSettled?: () => Promise<void>;
  /** Monotonic renderer-source recovery epoch. A changed value means the
   * supposedly final idle observed an asynchronous worker failure or heal and
   * must be followed by another complete settle/idle/paint pass. */
  settlementVersion?: () => number;
  /** Deterministic font/two-paint hook; injectable for browser-free tests. */
  afterFinalIdle?: () => Promise<void>;
}

const MAX_SETTLEMENT_PASSES = 8;

function waitForTwoPaints(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function waitForIdleAfter(map: RendererCaptureMap, mutate: () => unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    map.once('idle', resolve);
    try {
      mutate();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Measurement-only camera seam. It waits for MapLibre's source/layout work
 * and two painted frames, so every capture records settled pixels rather than
 * whichever frame happened to follow jumpTo. */
export function attachRendererCaptureHarness(
  map: RendererCaptureMap,
  host: RendererCaptureHost = window,
  options: RendererCaptureHarnessOptions = {},
): () => void {
  const settleRenderer = async () => {
    for (let pass = 0; pass < MAX_SETTLEMENT_PASSES; pass++) {
      await options.afterRendererSettled?.();
      const versionBeforeIdle = options.settlementVersion?.();
      // A renderer generation may have submitted new GeoJSON after the
      // camera's own idle event. Force one more paint and wait for MapLibre to
      // finish that source/layout epoch before taking two evidence frames.
      await waitForIdleAfter(map, () => map.triggerRepaint());
      if (versionBeforeIdle === undefined) {
        await (options.afterFinalIdle ?? waitForTwoPaints)();
        return;
      }
      // updateData rejection is reported through a later map error event, not
      // its synchronous call. Re-check recovery after idle and paint, then
      // repeat if either rejection or its full-scene heal changed the epoch.
      await options.afterRendererSettled?.();
      await (options.afterFinalIdle ?? waitForTwoPaints)();
      if (options.settlementVersion?.() === versionBeforeIdle) return;
    }
    throw new Error('Renderer source recovery did not become quiescent for capture.');
  };
  host.__rendererCaptureSetCamera = async (camera) => {
    await waitForIdleAfter(map, () => map.jumpTo(camera));
    await settleRenderer();
  };
  host.__rendererCaptureWhenSettled = settleRenderer;

  return () => {
    delete host.__rendererCaptureSetCamera;
    delete host.__rendererCaptureWhenSettled;
  };
}

declare global {
  interface Window {
    __rendererCaptureSetCamera?: (camera: RendererCaptureCamera) => Promise<void>;
    __rendererCaptureWhenSettled?: () => Promise<void>;
  }
}
