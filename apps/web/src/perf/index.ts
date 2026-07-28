import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import { attachFrameMeter } from './frameMeter';
import {
  runPanBench,
  runPanGestureBench,
  runZoomBench,
  type PanBenchOptions,
  type ZoomBenchOptions,
} from './panBench';
import type { FrameStats } from './frameStats';
import type { RawGestureMeasurements } from './gestureStats';

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
    __panGestureBench?: (opts?: PanBenchOptions) => Promise<RawGestureMeasurements>;
    __zoomBench?: (opts?: ZoomBenchOptions) => Promise<FrameStats>;
    __perfSourceUploadCount?: () => number;
    __TRANSITMAPPER_PERF_RUN__?: boolean;
  }
}

interface SourceUploadMeter {
  count: () => number;
  detach: () => void;
}

interface WrappedGeoJsonSource {
  source: GeoJSONSource;
  original: GeoJSONSource['setData'];
  wrapped: GeoJSONSource['setData'];
}

function attachSourceUploadMeter(map: MLMap): SourceUploadMeter {
  let uploads = 0;
  const wrappedSources: WrappedGeoJsonSource[] = [];
  for (const sourceId of Object.keys(map.getStyle().sources)) {
    const source = map.getSource(sourceId);
    if (!source || typeof (source as Partial<GeoJSONSource>).setData !== 'function') continue;
    const geoJsonSource = source as GeoJSONSource;
    const original = geoJsonSource.setData;
    const wrapped: GeoJSONSource['setData'] = function setData(
      this: GeoJSONSource,
      data: Parameters<GeoJSONSource['setData']>[0],
    ) {
      uploads += 1;
      return original.call(this, data);
    };
    geoJsonSource.setData = wrapped;
    wrappedSources.push({ source: geoJsonSource, original, wrapped });
  }
  return {
    count: () => uploads,
    detach: () => {
      for (const entry of wrappedSources) {
        if (entry.source.setData === entry.wrapped) entry.source.setData = entry.original;
      }
    },
  };
}

function automatedPerfRun(): boolean {
  return window.__TRANSITMAPPER_PERF_RUN__ === true;
}

function perfHarnessEnabled(): boolean {
  return import.meta.env.DEV || automatedPerfRun();
}

/**
 * DEV-only performance harness: a live painted-frame overlay, a scripted pan
 * benchmark (`window.__panBench`), and A/B flags (`window.__perf`). Never ships
 * enabled — the sole caller (map/MapCanvas.tsx) guards on import.meta.env.DEV,
 * and this also no-ops defensively in production.
 */
export function attachPerfHarness(map: MLMap): () => void {
  if (!perfHarnessEnabled()) return () => {};
  window.__perf ??= { vehicles: true };
  // The live overlay is useful in devtools but adds a perpetual rAF loop. The
  // automated runner asks for raw gesture samples directly and stays clean.
  const meter = automatedPerfRun() ? undefined : attachFrameMeter(map);
  const sourceUploads = attachSourceUploadMeter(map);
  window.__perfSourceUploadCount = sourceUploads.count;
  if (meter) window.__frameStats = meter.stats;
  window.__panBench = (opts) => runPanBench(map, opts);
  window.__panGestureBench = (opts) => runPanGestureBench(map, sourceUploads.count, opts);
  window.__zoomBench = (opts) => runZoomBench(map, opts);
  return () => {
    meter?.detach();
    sourceUploads.detach();
    delete window.__frameStats;
    delete window.__panBench;
    delete window.__panGestureBench;
    delete window.__zoomBench;
    delete window.__perfSourceUploadCount;
  };
}

/** True when the DEV vehicle A/B toggle is OFF — read by sim/vehicles.ts so the
 *  benchmark can isolate the vehicle loop's cost. Always false in production. */
export function vehiclesDisabledForPerf(): boolean {
  return import.meta.env.DEV && window.__perf?.vehicles === false;
}
