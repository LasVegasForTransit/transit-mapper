export interface RenderEventMap {
  on: (event: 'render', listener: () => void) => unknown;
  off: (event: 'render', listener: () => void) => unknown;
}

export interface PaintedFrameCapture {
  start: () => void;
  stop: () => number[];
  detach: () => void;
}

const MAX_ACTIVE_FRAME_GAP_MS = 500;

/** Capture MapLibre render intervals only while a measured pointer sequence is
 * active. */
export function attachPaintedFrameCapture(map: RenderEventMap): PaintedFrameCapture {
  let active = false;
  let lastPaintAt: number | null = null;
  let durations: number[] = [];
  const onRender = () => {
    if (!active) return;
    const now = performance.now();
    if (lastPaintAt !== null) {
      const duration = now - lastPaintAt;
      if (duration > 0 && duration < MAX_ACTIVE_FRAME_GAP_MS) durations.push(duration);
    }
    lastPaintAt = now;
  };
  map.on('render', onRender);

  return {
    start: () => {
      durations = [];
      lastPaintAt = null;
      active = true;
    },
    stop: () => {
      active = false;
      lastPaintAt = null;
      return [...durations];
    },
    detach: () => {
      active = false;
      map.off('render', onRender);
    },
  };
}
