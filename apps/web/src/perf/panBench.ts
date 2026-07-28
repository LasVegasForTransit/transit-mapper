import type { Map as MLMap } from 'maplibre-gl';
import { formatFrameStats, summarizeFrames, type FrameStats } from './frameStats';
import type { RawGestureMeasurements } from './gestureStats';

export interface PanBenchOptions {
  /** Number of pan increments (one per frame). */
  steps?: number;
  /** Pixels moved per increment (x, y). */
  dx?: number;
  dy?: number;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Scripted, repeatable pan: nudge the camera `steps` times, one per animation
 * frame — the same shape as the app's real per-mousemove panBy(duration:0) drag
 * gesture — and measure the painted-frame intervals under that load. Because the
 * input is deterministic, before/after runs of the SAME scenario (view + zoom)
 * are directly comparable, which is what turns "feels smoother" into a number.
 *
 * Usage (devtools, after importing an RTC-scale system and framing the whole
 * valley): `await __panBench()` — then flip `__perf.vehicles=false` (or toggle a
 * label layer) and run it again to attribute each contributor.
 */
export async function runPanBench(map: MLMap, opts: PanBenchOptions = {}): Promise<FrameStats> {
  const { steps = 80, dx = 8, dy = 0 } = opts;
  const durations: number[] = [];
  let last = performance.now();
  const onRender = () => {
    const now = performance.now();
    durations.push(now - last);
    last = now;
  };
  map.on('render', onRender);
  last = performance.now();
  for (let i = 0; i < steps; i++) {
    map.panBy([dx, dy], { duration: 0 });
    await nextFrame();
  }
  map.off('render', onRender);
  const stats = summarizeFrames(durations.slice(2)); // drop warm-up frames

  console.log(`[panBench] steps=${steps} dx=${dx} → ${formatFrameStats(stats)}`);
  return stats;
}

/**
 * The CI counterpart to runPanBench. It retains the raw painted-frame and
 * command-to-render samples so the report can enforce p95 and tail gates,
 * while the console-oriented benchmark above keeps its compact FrameStats API.
 */
export async function runPanGestureBench(
  map: MLMap,
  sourceUploadCount: () => number,
  opts: PanBenchOptions = {},
): Promise<RawGestureMeasurements> {
  const { steps = 80, dx = 8, dy = 0 } = opts;
  const paintedFrameMs: number[] = [];
  const inputToNextPaintMs: number[] = [];
  const longTaskMs: number[] = [];
  const uploadsBefore = sourceUploadCount();
  let lastPaint = performance.now();
  const onRender = () => {
    const now = performance.now();
    paintedFrameMs.push(now - lastPaint);
    lastPaint = now;
  };
  map.on('render', onRender);

  let longTaskObserver: PerformanceObserver | undefined;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTaskMs.push(entry.duration);
    });
    longTaskObserver.observe({ type: 'longtask', buffered: false });
  } catch {
    // Older Chrome builds without Long Tasks still produce the direct
    // manipulation metrics. The fixed CI channel makes this exceptional.
  }

  lastPaint = performance.now();
  try {
    for (let step = 0; step < steps; step += 1) {
      const painted = new Promise<void>((resolve) => {
        map.once('render', () => resolve());
      });
      const inputAt = performance.now();
      map.panBy([dx, dy], { duration: 0 });
      await painted;
      inputToNextPaintMs.push(performance.now() - inputAt);
      await nextFrame();
    }
  } finally {
    longTaskObserver?.disconnect();
    map.off('render', onRender);
  }

  // The first two paints include listener and renderer warm-up. The scenario
  // itself already gets a whole warm-up run too; neither belongs in the gate.
  return {
    inputToNextPaintMs: inputToNextPaintMs.slice(2),
    paintedFrameMs: paintedFrameMs.slice(2),
    longTaskMs,
    sourceUploadCount: sourceUploadCount() - uploadsBefore,
  };
}

export interface ZoomBenchOptions {
  /** Zoom increments in each direction (in, then back out). */
  steps?: number;
  /** Zoom-level delta per step. */
  dz?: number;
}

/**
 * Scripted zoom: ramp the zoom level in `steps` increments then back out, one
 * per frame, measuring painted-frame time under the zoom load — the zoom
 * counterpart to runPanBench. Zoom exercises symbol placement and fill-rate
 * (all on-screen station circles / route lines redrawn every frame), which pan
 * does not, so this isolates zoom cost specifically.
 */
export async function runZoomBench(map: MLMap, opts: ZoomBenchOptions = {}): Promise<FrameStats> {
  const { steps = 60, dz = 0.06 } = opts;
  const startZoom = map.getZoom();
  const durations: number[] = [];
  let last = performance.now();
  const onRender = () => {
    const now = performance.now();
    durations.push(now - last);
    last = now;
  };
  map.on('render', onRender);
  last = performance.now();
  for (let i = 1; i <= steps; i++) {
    map.setZoom(startZoom + dz * i);
    await nextFrame();
  }
  for (let i = steps - 1; i >= 0; i--) {
    map.setZoom(startZoom + dz * i);
    await nextFrame();
  }
  map.off('render', onRender);
  const stats = summarizeFrames(durations.slice(2));

  console.log(
    `[zoomBench] steps=${steps} dz=${dz} (z${startZoom.toFixed(1)}→z${(startZoom + dz * steps).toFixed(1)}) → ${formatFrameStats(stats)}`,
  );
  return stats;
}
