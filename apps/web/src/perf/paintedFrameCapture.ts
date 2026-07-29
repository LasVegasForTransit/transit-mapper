export interface RenderEventMap {
  on: (event: 'render', listener: () => void) => unknown;
  off: (event: 'render', listener: () => void) => unknown;
}

export interface PaintedFrameCapture {
  start: () => void;
  stop: () => number[];
  detach: () => void;
}

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
      // The capture is already bounded by start/stop. An upper cutoff would
      // erase the exact unresponsive frames this harness is meant to expose.
      if (duration > 0) durations.push(duration);
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
