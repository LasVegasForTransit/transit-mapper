interface RendererCaptureCamera {
  center: [number, number];
  zoom: number;
}

interface RendererCaptureMap {
  once(event: 'idle', listener: () => void): void;
  jumpTo(camera: RendererCaptureCamera): unknown;
}

export interface RendererCaptureHost {
  __rendererCaptureSetCamera?: (camera: RendererCaptureCamera) => Promise<void>;
}

function waitForTwoPaints(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

/** Measurement-only camera seam. It waits for MapLibre's source/layout work
 * and two painted frames, so every capture records settled pixels rather than
 * whichever frame happened to follow jumpTo. */
export function attachRendererCaptureHarness(
  map: RendererCaptureMap,
  host: RendererCaptureHost = window,
  afterIdle: () => Promise<void> = waitForTwoPaints,
): () => void {
  host.__rendererCaptureSetCamera = (camera) =>
    new Promise<void>((resolve, reject) => {
      map.once('idle', () => {
        afterIdle().then(resolve, reject);
      });
      map.jumpTo(camera);
    });

  return () => {
    delete host.__rendererCaptureSetCamera;
  };
}

declare global {
  interface Window {
    __rendererCaptureSetCamera?: (camera: RendererCaptureCamera) => Promise<void>;
  }
}
