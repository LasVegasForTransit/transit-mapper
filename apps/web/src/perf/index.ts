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
import { attachPaintedFrameCapture } from './paintedFrameCapture';
import { attachRendererCaptureHarness } from './renderer-capture-harness';
import type { RendererStatsSnapshot } from './renderer-stats';

/** Runtime A/B toggles, flipped from the devtools console to attribute cost —
 *  e.g. `__perf.vehicles = false` then re-run `await __panBench()` to see the
 *  vehicle loop's share of the pan frame budget. */
interface DevPerfFlags {
  vehicles: boolean;
}

interface PerfStopSnapshot {
  coord: [number, number];
  revision: number;
  wayCount: number;
}

interface PerfOverlaySnapshot {
  sourceExists: boolean;
  layerExists: boolean;
  sourceLoaded: boolean;
  featureCount: number;
}

export interface PerfHarnessOptions {
  stopSnapshot?: (stopId: string) => PerfStopSnapshot | null;
  overlaySnapshot?: () => PerfOverlaySnapshot;
  rendererStats?: () => RendererStatsSnapshot;
}

declare global {
  interface Window {
    __perf?: DevPerfFlags;
    __frameStats?: () => FrameStats;
    __panBench?: (opts?: PanBenchOptions) => Promise<FrameStats>;
    __panGestureBench?: (opts?: PanBenchOptions) => Promise<RawGestureMeasurements>;
    __zoomBench?: (opts?: ZoomBenchOptions) => Promise<FrameStats>;
    __perfSourceUploadCount?: () => number;
    __perfProjectLngLat?: (coord: [number, number]) => { x: number; y: number };
    __perfStopSnapshot?: (stopId: string) => PerfStopSnapshot | null;
    __perfCameraSnapshot?: () => { center: [number, number]; zoom: number };
    __perfOverlaySnapshot?: () => PerfOverlaySnapshot;
    __perfStartPaintedFrameCapture?: () => void;
    __perfStopPaintedFrameCapture?: () => number[];
    __rendererStats?: () => RendererStatsSnapshot;
    __TRANSITMAPPER_PERF_RUN__?: boolean;
  }
}

export interface SourceUploadMeter {
  count: () => number;
  detach: () => void;
}

interface WrappedSetDataSource {
  source: GeoJSONSource;
  original: GeoJSONSource['setData'];
  wrapped: GeoJSONSource['setData'];
}

interface WrappedUpdateDataSource {
  source: GeoJSONSource;
  original: GeoJSONSource['updateData'];
  wrapped: GeoJSONSource['updateData'];
}

export function attachSourceUploadMeter(map: MLMap): SourceUploadMeter {
  let uploads = 0;
  const wrappedSetDataSources: WrappedSetDataSource[] = [];
  const wrappedUpdateDataSources: WrappedUpdateDataSource[] = [];
  for (const sourceId of Object.keys(map.getStyle().sources)) {
    const source = map.getSource(sourceId);
    if (!source) continue;
    const geoJsonSource = source as GeoJSONSource;
    if (typeof (source as Partial<GeoJSONSource>).setData === 'function') {
      const original = Reflect.get(geoJsonSource, 'setData');
      const wrapped: GeoJSONSource['setData'] = function setData(
        this: GeoJSONSource,
        data: Parameters<GeoJSONSource['setData']>[0],
      ) {
        uploads += 1;
        return original.call(this, data);
      };
      geoJsonSource.setData = wrapped;
      wrappedSetDataSources.push({ source: geoJsonSource, original, wrapped });
    }
    if (typeof (source as Partial<GeoJSONSource>).updateData === 'function') {
      const original = Reflect.get(geoJsonSource, 'updateData');
      const wrapped: GeoJSONSource['updateData'] = function updateData(
        this: GeoJSONSource,
        diff: Parameters<GeoJSONSource['updateData']>[0],
      ) {
        uploads += 1;
        return original.call(this, diff);
      };
      geoJsonSource.updateData = wrapped;
      wrappedUpdateDataSources.push({ source: geoJsonSource, original, wrapped });
    }
  }
  return {
    count: () => uploads,
    detach: () => {
      for (const entry of wrappedSetDataSources) {
        if (entry.source.setData === entry.wrapped) entry.source.setData = entry.original;
      }
      for (const entry of wrappedUpdateDataSources) {
        if (entry.source.updateData === entry.wrapped) entry.source.updateData = entry.original;
      }
    },
  };
}

function automatedPerfRun(): boolean {
  return window.__TRANSITMAPPER_PERF_RUN__ === true;
}

function perfHarnessEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_PERF_BUILD === '1';
}

/**
 * Development/performance-build harness: a live painted-frame overlay, a
 * scripted pan benchmark (`window.__panBench`), and A/B flags (`window.__perf`).
 * MapCanvas guards the call with the same compile-time flag, which lets Rollup
 * remove this module from ordinary production builds.
 */
export function attachPerfHarness(map: MLMap, options: PerfHarnessOptions = {}): () => void {
  if (!perfHarnessEnabled()) return () => {};
  window.__perf ??= { vehicles: true };
  // The live overlay is useful in devtools but adds a perpetual rAF loop. The
  // automated runner asks for raw gesture samples directly and stays clean.
  const meter = automatedPerfRun() ? undefined : attachFrameMeter(map);
  const sourceUploads = attachSourceUploadMeter(map);
  const paintedFrames = attachPaintedFrameCapture(map);
  const detachRendererCapture = attachRendererCaptureHarness(map);
  window.__perfSourceUploadCount = sourceUploads.count;
  window.__perfProjectLngLat = (coord) => {
    const point = map.project(coord);
    const bounds = map.getCanvas().getBoundingClientRect();
    return { x: bounds.left + point.x, y: bounds.top + point.y };
  };
  window.__perfCameraSnapshot = () => {
    const center = map.getCenter();
    return { center: [center.lng, center.lat], zoom: map.getZoom() };
  };
  if (options.stopSnapshot) window.__perfStopSnapshot = options.stopSnapshot;
  if (options.overlaySnapshot) window.__perfOverlaySnapshot = options.overlaySnapshot;
  if (options.rendererStats) window.__rendererStats = options.rendererStats;
  window.__perfStartPaintedFrameCapture = paintedFrames.start;
  window.__perfStopPaintedFrameCapture = paintedFrames.stop;
  if (meter) window.__frameStats = meter.stats;
  window.__panBench = (opts) => runPanBench(map, opts);
  window.__panGestureBench = (opts) => runPanGestureBench(map, sourceUploads.count, opts);
  window.__zoomBench = (opts) => runZoomBench(map, opts);
  return () => {
    meter?.detach();
    sourceUploads.detach();
    paintedFrames.detach();
    detachRendererCapture();
    delete window.__frameStats;
    delete window.__panBench;
    delete window.__panGestureBench;
    delete window.__zoomBench;
    delete window.__perfSourceUploadCount;
    delete window.__perfProjectLngLat;
    delete window.__perfCameraSnapshot;
    delete window.__perfStopSnapshot;
    delete window.__perfOverlaySnapshot;
    delete window.__rendererStats;
    delete window.__perfStartPaintedFrameCapture;
    delete window.__perfStopPaintedFrameCapture;
  };
}

/** True when the DEV vehicle A/B toggle is OFF — read by sim/vehicles.ts so the
 *  benchmark can isolate the vehicle loop's cost. Always false in production. */
export function vehiclesDisabledForPerf(): boolean {
  return import.meta.env.DEV && window.__perf?.vehicles === false;
}
