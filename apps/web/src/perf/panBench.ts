import type { Map as MLMap } from "maplibre-gl";
import { formatFrameStats, summarizeFrames, type FrameStats } from "./frameStats";

export interface PanBenchOptions {
  /** Number of pan increments (one per frame). */
  steps?: number;
  /** Pixels moved per increment (x, y). */
  dx?: number;
  dy?: number;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

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
  map.on("render", onRender);
  last = performance.now();
  for (let i = 0; i < steps; i++) {
    map.panBy([dx, dy], { duration: 0 });
    await nextFrame();
  }
  map.off("render", onRender);
  const stats = summarizeFrames(durations.slice(2)); // drop warm-up frames
  // eslint-disable-next-line no-console
  console.log(`[panBench] steps=${steps} dx=${dx} → ${formatFrameStats(stats)}`);
  return stats;
}
