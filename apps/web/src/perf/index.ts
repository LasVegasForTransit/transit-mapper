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
import type { CooperativeRenderJobSchedulerStats } from '@transitmapper/renderer/projection';
import type { SourceBankDiagnostics } from '@transitmapper/map/runtime';
import type { RendererStatsSnapshot } from '@transitmapper/renderer/stats';
import { MAP_THEMES } from '../map/mapThemePalette';
import type { SourceUploadTiming } from './source-uploads';

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
  symbolLayerExists: boolean;
  overlayHealthy: boolean;
  rendererLayerCount: number;
  expectedRendererLayerCount: number;
  sourceLoaded: boolean;
  featureCount: number;
}

export interface PerfRenderSourceBankSnapshot {
  activeBank: 'a' | 'b' | null;
  stagingBank: 'a' | 'b' | null;
  activeRevision: string | null;
  activeVisualSourceIds: readonly string[];
  activeVisualLayerIds: readonly string[];
  activeVisualSourceId: string | null;
  activeHitSourceId: string | null;
  activeHitLayerIds: readonly string[];
  activeVisualLayerId: string | null;
  activeHitLayerId: string | null;
  selectedFeatureStateSourceIds: readonly string[];
  diagnostics: SourceBankDiagnostics;
  scheduler?: CooperativeRenderJobSchedulerStats;
}

export interface PerfHarnessOptions {
  stopSnapshot?: (stopId: string) => PerfStopSnapshot | null;
  overlaySnapshot?: () => PerfOverlaySnapshot;
  rendererStats?: () => RendererStatsSnapshot;
  rendererSettled?: () => Promise<void>;
  rendererSettlementVersion?: () => number;
  renderSourceBankSnapshot?: () => PerfRenderSourceBankSnapshot;
}

declare global {
  interface Window {
    __perf?: DevPerfFlags;
    __frameStats?: () => FrameStats;
    __panBench?: (opts?: PanBenchOptions) => Promise<FrameStats>;
    __panGestureBench?: (opts?: PanBenchOptions) => Promise<RawGestureMeasurements>;
    __zoomBench?: (opts?: ZoomBenchOptions) => Promise<FrameStats>;
    __perfSourceUploadCount?: () => number;
    __perfSourceUploadTimings?: () => readonly SourceUploadTiming[];
    __perfProjectLngLat?: (coord: [number, number]) => { x: number; y: number };
    __perfStopSnapshot?: (stopId: string) => PerfStopSnapshot | null;
    __perfCameraSnapshot?: () => { center: [number, number]; zoom: number };
    __perfOverlaySnapshot?: () => PerfOverlaySnapshot;
    __perfStartPaintedFrameCapture?: () => void;
    __perfStopPaintedFrameCapture?: () => number[];
    __rendererStats?: () => RendererStatsSnapshot;
    __perfRenderSourceBankSnapshot?: () => PerfRenderSourceBankSnapshot;
    __mapStartupTrace?: () => readonly string[];
    __perfRenderedFeaturesAt?: (
      coordinate: [number, number],
    ) => readonly RendererPerfRenderedFeature[];
    __perfRendererLayerVisibility?: () => readonly RendererPerfLayerVisibility[];
    __TRANSITMAPPER_PERF_RUN__?: boolean;
  }
}

export interface SourceUploadMeter {
  count: () => number;
  snapshot: () => readonly SourceUploadTiming[];
  detach: () => void;
}

export interface RendererPerfFeatureState {
  readonly sourceId: string;
  readonly featureId: string;
  readonly hover: boolean;
  readonly selected: boolean;
}

/** A serializable rendered feature used to diagnose browser interaction
 * failures without exposing the MapLibre instance to the performance runner. */
export interface RendererPerfRenderedFeature {
  readonly sourceId: string;
  readonly layerId: string;
  readonly featureId: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface RendererPerfLayerFilter {
  readonly layerId: string;
  readonly filter: unknown;
}

export interface RendererPerfLayerVisibility {
  readonly layerId: string;
  readonly visibility: 'visible' | 'none';
}

function booleanFeatureState(state: unknown, key: string): boolean {
  if (typeof state !== 'object' || state === null) return false;
  const value: unknown = Reflect.get(state, key);
  return value === true;
}

/** Reads the theme MapLibre actually retained, rather than the requested UI state. */
export function rendererPerfMapScheme(map: MLMap): 'light' | 'dark' {
  const style = (map as Partial<MLMap>).getStyle?.();
  const backgroundLayerId =
    style?.layers.find((layer) => layer.type === 'background')?.id ??
    'transitmapper-local-background';
  return map.getPaintProperty(backgroundLayerId, 'background-color') === MAP_THEMES.dark.background
    ? 'dark'
    : 'light';
}

/** Captures the feature-state values that are observable at one rendered point. */
export function rendererPerfFeatureStatesAt(
  map: MLMap,
  bank: PerfRenderSourceBankSnapshot,
  coordinate: [number, number],
): RendererPerfFeatureState[] {
  const layers = [...new Set([...bank.activeVisualLayerIds, ...bank.activeHitLayerIds])].filter(
    (layerId) => map.getLayer(layerId) !== undefined,
  );
  const point = map.project(coordinate);
  const seen = new Set<string>();
  const states: RendererPerfFeatureState[] = [];
  for (const feature of map.queryRenderedFeatures(point, { layers })) {
    if (typeof feature.source !== 'string' || feature.id === undefined) continue;
    const featureId = String(feature.id);
    const key = `${feature.source}\u0000${featureId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const state: unknown = map.getFeatureState({ source: feature.source, id: feature.id });
    states.push({
      sourceId: feature.source,
      featureId,
      hover: booleanFeatureState(state, 'hover'),
      selected: booleanFeatureState(state, 'selected'),
    });
  }
  return states.sort(
    (left, right) =>
      left.sourceId.localeCompare(right.sourceId) || left.featureId.localeCompare(right.featureId),
  );
}

/** Captures the active-bank features MapLibre returns at a point. This reads
 * the same physical layers that the editor uses for a pointer gesture. */
export function rendererPerfFeaturesAt(
  map: MLMap,
  bank: PerfRenderSourceBankSnapshot,
  coordinate: [number, number],
): RendererPerfRenderedFeature[] {
  const layers = [...new Set([...bank.activeVisualLayerIds, ...bank.activeHitLayerIds])].filter(
    (layerId) => map.getLayer(layerId) !== undefined,
  );
  if (layers.length === 0) return [];
  const point = map.project(coordinate);
  return map.queryRenderedFeatures(point, { layers }).map((feature) => ({
    sourceId: typeof feature.source === 'string' ? feature.source : '',
    layerId: feature.layer.id,
    featureId: feature.id === undefined ? null : String(feature.id),
    properties: { ...feature.properties },
  }));
}

/** Captures active-bank layer visibility so a missing interaction target can
 * distinguish absent data from an intentionally hidden layer. */
export function rendererPerfLayerVisibility(
  map: MLMap,
  bank: PerfRenderSourceBankSnapshot,
): RendererPerfLayerVisibility[] {
  return [...new Set([...bank.activeVisualLayerIds, ...bank.activeHitLayerIds])]
    .sort()
    .flatMap((layerId) => {
      if (!map.getLayer(layerId)) return [];
      const getLayoutProperty = map.getLayoutProperty.bind(map) as unknown as (
        layer: string,
        property: string,
      ) => unknown;
      const visibility = getLayoutProperty(layerId, 'visibility');
      return [{ layerId, visibility: visibility === 'none' ? 'none' : 'visible' }];
    });
}

/** Serializes the filters applied to every active renderer layer for evidence. */
export function rendererPerfFilterSnapshot(
  map: MLMap,
  bank: PerfRenderSourceBankSnapshot,
): RendererPerfLayerFilter[] {
  const layerIds = [...new Set([...bank.activeVisualLayerIds, ...bank.activeHitLayerIds])].sort();
  return layerIds.flatMap((layerId) =>
    map.getLayer(layerId) ? [{ layerId, filter: map.getFilter(layerId) }] : [],
  );
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
  const timings = new Map<string, SourceUploadTiming>();
  const wrappedSetDataSources: WrappedSetDataSource[] = [];
  const wrappedUpdateDataSources: WrappedUpdateDataSource[] = [];
  const recordTiming = (
    sourceId: string,
    method: SourceUploadTiming['method'],
    durationMs: number,
  ) => {
    const key = `${sourceId}\u0000${method}`;
    const timing = timings.get(key) ?? {
      sourceId,
      method,
      callCount: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    };
    timing.callCount += 1;
    timing.totalDurationMs += durationMs;
    timing.maxDurationMs = Math.max(timing.maxDurationMs, durationMs);
    timings.set(key, timing);
  };
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
        const startedAt = performance.now();
        try {
          return original.call(this, data);
        } finally {
          recordTiming(sourceId, 'setData', performance.now() - startedAt);
        }
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
        const startedAt = performance.now();
        try {
          return original.call(this, diff);
        } finally {
          recordTiming(sourceId, 'updateData', performance.now() - startedAt);
        }
      };
      geoJsonSource.updateData = wrapped;
      wrappedUpdateDataSources.push({ source: geoJsonSource, original, wrapped });
    }
  }
  return {
    count: () => uploads,
    snapshot: () => [...timings.values()].map((timing) => ({ ...timing })),
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
  const detachRendererCapture = attachRendererCaptureHarness(map, window, {
    afterRendererSettled: options.rendererSettled,
    settlementVersion: options.rendererSettlementVersion,
  });
  window.__perfSourceUploadCount = sourceUploads.count;
  window.__perfSourceUploadTimings = sourceUploads.snapshot;
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
  const renderSourceBankSnapshot = options.renderSourceBankSnapshot;
  if (renderSourceBankSnapshot) {
    window.__perfRenderSourceBankSnapshot = renderSourceBankSnapshot;
    window.__perfRenderedFeaturesAt = (coordinate) =>
      rendererPerfFeaturesAt(map, renderSourceBankSnapshot(), coordinate);
    window.__perfRendererLayerVisibility = () =>
      rendererPerfLayerVisibility(map, renderSourceBankSnapshot());
  }
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
    delete window.__perfSourceUploadTimings;
    delete window.__perfProjectLngLat;
    delete window.__perfCameraSnapshot;
    delete window.__perfStopSnapshot;
    delete window.__perfOverlaySnapshot;
    delete window.__rendererStats;
    delete window.__perfRenderSourceBankSnapshot;
    delete window.__perfRenderedFeaturesAt;
    delete window.__perfRendererLayerVisibility;
    delete window.__perfStartPaintedFrameCapture;
    delete window.__perfStopPaintedFrameCapture;
  };
}

/** True when the DEV vehicle A/B toggle is OFF — read by sim/vehicles.ts so the
 *  benchmark can isolate the vehicle loop's cost. Always false in production. */
export function vehiclesDisabledForPerf(): boolean {
  return import.meta.env.DEV && window.__perf?.vehicles === false;
}
