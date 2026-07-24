import type { Map as MLMap } from "maplibre-gl";
import { attachFrameMeter } from "./frameMeter";
import { runPanBench, runZoomBench, type PanBenchOptions, type ZoomBenchOptions } from "./panBench";
import type { FrameStats } from "./frameStats";

/** Runtime A/B toggles, flipped from the devtools console to attribute cost —
 *  e.g. `__perf.vehicles = false` then re-run `await __panBench()` to see the
 *  vehicle loop's share of the pan frame budget. */
export interface DevPerfFlags {
  vehicles: boolean;
}

declare global {
  interface Window {
    __perf?: DevPerfFlags;
    __frameStats?: () => FrameStats;
    __panBench?: (opts?: PanBenchOptions) => Promise<FrameStats>;
    __zoomBench?: (opts?: ZoomBenchOptions) => Promise<FrameStats>;
  }
}

/**
 * DEV-only performance harness: a live painted-frame overlay, a scripted pan
 * benchmark (`window.__panBench`), and A/B flags (`window.__perf`). Never ships
 * enabled — the sole caller (map/MapCanvas.tsx) guards on import.meta.env.DEV,
 * and this also no-ops defensively in production.
 */
export function attachPerfHarness(map: MLMap): () => void {
  if (!import.meta.env.DEV) return () => {};
  window.__perf ??= { vehicles: true };
  const meter = attachFrameMeter(map);
  window.__frameStats = meter.stats;
  window.__panBench = (opts) => runPanBench(map, opts);
  window.__zoomBench = (opts) => runZoomBench(map, opts);
  return () => {
    meter.detach();
    delete window.__frameStats;
    delete window.__panBench;
    delete window.__zoomBench;
  };
}

/** True when the DEV vehicle A/B toggle is OFF — read by sim/vehicles.ts so the
 *  benchmark can isolate the vehicle loop's cost. Always false in production. */
export function vehiclesDisabledForPerf(): boolean {
  return import.meta.env.DEV && window.__perf?.vehicles === false;
}
