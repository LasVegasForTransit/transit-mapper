import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import { systemBounds } from '@transitmapper/core/model/geo';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import { basemapStyleForScheme } from '../mapTheme';
import { armVisibilityAwareTimeout } from './visibilityAwareTimeout';
import { LYR_STATIONS, registerMapIcons } from '../layers';
import { addExportSourcesAndLayers, setExportFeatureData } from './exportLayerSetup';
import { projectFeaturesForFittedMap } from '../static-render-features';
import { createFeatureProjectionWorker } from '../feature-projection-worker';

const DEFAULT_SIZE = { width: 1600, height: 1000 };
const RENDER_TIMEOUT_MS = 20000;

export interface ExportRenderOptions {
  /** Output size in CSS px (the real pixel size is this × devicePixelRatio). */
  width?: number;
  height?: number;
  padding?: number;
}

export interface RenderedExport {
  /** The offscreen map — kept alive so the caller can composite title/legend/
   *  scale/north (which read map bearing/zoom). Call dispose() when done. */
  map: MLMap;
  canvas: HTMLCanvasElement;
  dispose: () => void;
}

function configureExportStationPaint(map: MLMap): void {
  if (!map.getLayer(LYR_STATIONS)) return;
  map.setPaintProperty(LYR_STATIONS, 'circle-radius', [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    ['case', ['get', 'interchange'], 2.2, 1.4],
    14,
    ['case', ['get', 'interchange'], 5, 3.5],
  ]);
  map.setPaintProperty(LYR_STATIONS, 'circle-stroke-width', [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    0.7,
    14,
    2,
  ]);
}

/**
 * Render a whole system into a short-lived, OFFSCREEN MapLibre instance and
 * resolve with its painted canvas — a dedicated "offline render path", fully
 * separate from the interactive map (map/MapCanvas.tsx).
 *
 * This is what lets the live map drop `preserveDrawingBuffer`: PNG export used
 * to read the live map's canvas back out, which forced the always-on per-frame
 * drawing-buffer copy on it. Only THIS instance keeps the flag, and only for
 * the moment it takes to capture. The offscreen map also renders the EXACT
 * source geometry and full label set at whole-system framing, independent of
 * whatever LOD/zoom the interactive map happens to be at.
 *
 * The caller composites using the returned map + canvas, then MUST call
 * dispose() (a try/finally) to tear down the map and its hidden container.
 */
export function renderSystemForExport(
  system: TransitSystem,
  view: ViewOptions,
  opts: ExportRenderOptions = {},
): Promise<RenderedExport> {
  const width = Math.max(1, Math.round(opts.width ?? DEFAULT_SIZE.width));
  const height = Math.max(1, Math.round(opts.height ?? DEFAULT_SIZE.height));
  const padding = opts.padding ?? 56;

  return new Promise<RenderedExport>((resolve, reject) => {
    const container = document.createElement('div');
    container.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
    document.body.appendChild(container);

    const map = new maplibregl.Map({
      container,
      style: basemapStyleForScheme('light'),
      preserveDrawingBuffer: true, // this offscreen instance is the ONE place that reads pixels back
      attributionControl: false,
      fadeDuration: 0,
      interactive: false,
    });
    const featureProjection = createFeatureProjectionWorker();

    let settled = false;
    const dispose = () => {
      timeout.cancel();
      featureProjection.dispose();
      try {
        map.remove();
      } catch {
        // already removed
      }
      container.remove();
    };

    function fail(err: unknown): void {
      if (settled) return;
      settled = true;
      timeout.cancel();
      dispose();
      reject(err instanceof Error ? err : new Error(String(err)));
    }

    // See visibilityAwareTimeout.ts: MapLibre's tile loading and painting run
    // entirely on requestAnimationFrame, which browsers fully suspend while
    // the document is hidden, so a flat wall-clock timeout fires spuriously
    // on exports that would otherwise complete fine once the tab is visible.
    const timeout = armVisibilityAwareTimeout(
      RENDER_TIMEOUT_MS,
      () => fail(new Error('Export render timed out.')),
      document,
      () => map.triggerRepaint(),
    );

    map.on('error', (e) => fail(e.error ?? new Error('Export map error.')));
    map.on('load', () => {
      void (async () => {
        try {
          registerMapIcons(map, 'light');
          addExportSourcesAndLayers(map);

          // Export-only: a full-system export frames thousands of stops at once, so
          // shrink station circles here (on the export map, NOT the live map) to
          // keep dense networks legible instead of a mass of full-size rings. Still
          // zoom-interpolated, so a small/sparse system (framed at a higher zoom)
          // keeps readable dots. Live-map dots keep their reasonable floor.
          configureExportStationPaint(map);

          // Resize BEFORE fitBounds — fitBounds reads the current container size.
          map.resize();
          const bounds = systemBounds(system);
          if (bounds) map.fitBounds(bounds, { padding, animate: false });

          const fc = await projectFeaturesForFittedMap({
            worker: featureProjection,
            system,
            view,
            map,
          });
          setExportFeatureData(map, fc);

          map.once('idle', () => {
            if (settled) return;
            settled = true;
            timeout.cancel();
            resolve({ map, canvas: map.getCanvas(), dispose });
          });
          map.triggerRepaint();
        } catch (e) {
          fail(e);
        }
      })();
    });
  });
}
