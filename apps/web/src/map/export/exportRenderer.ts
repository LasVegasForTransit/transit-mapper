import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import { systemBounds } from '@transitmapper/core/model/geo';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { BASEMAP_STYLE } from '../basemap';
import { landmarksFeatureCollection } from '../landmarks';
import { armVisibilityAwareTimeout } from './visibilityAwareTimeout';
import {
  buildFeatures,
  LAYER_SPECS,
  LYR_STATIONS,
  registerMapIcons,
  SRC_CONNECTORS,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_JUNCTIONS,
  SRC_LANDMARKS,
  SRC_LANE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_LANES,
  SRC_PLATFORMS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAY_LABELS,
  SRC_WAYS,
  type ViewOptions,
} from '../layers';

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };
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
      style: BASEMAP_STYLE,
      preserveDrawingBuffer: true, // this offscreen instance is the ONE place that reads pixels back
      attributionControl: false,
      fadeDuration: 0,
      interactive: false,
    });

    let settled = false;
    const dispose = () => {
      timeout.cancel();
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
      try {
        registerMapIcons(map);
        // Add every source ANY layer references (derived from LAYER_SPECS) so
        // addLayer never throws on a missing source — the static context source
        // gets the real landmarks, the rest start empty.
        for (const spec of LAYER_SPECS) {
          const src = 'source' in spec ? spec.source : undefined;
          if (typeof src !== 'string' || map.getSource(src)) continue;
          map.addSource(src, {
            type: 'geojson',
            data: src === SRC_LANDMARKS ? landmarksFeatureCollection() : EMPTY_FC,
          });
        }
        for (const spec of LAYER_SPECS) map.addLayer(spec);

        // Export-only: a full-system export frames thousands of stops at once, so
        // shrink station circles here (on the export map, NOT the live map) to
        // keep dense networks legible instead of a mass of full-size rings. Still
        // zoom-interpolated, so a small/sparse system (framed at a higher zoom)
        // keeps readable dots. Live-map dots keep their reasonable floor.
        if (map.getLayer(LYR_STATIONS)) {
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

        // Resize BEFORE fitBounds — fitBounds reads the current container size.
        map.resize();
        const bounds = systemBounds(system);
        if (bounds) map.fitBounds(bounds, { padding, animate: false });

        const fc = buildFeatures(system, null, [], view);
        const set = (src: string, data: GeoJSON.FeatureCollection) =>
          (map.getSource(src) as GeoJSONSource | undefined)?.setData(data);
        set(SRC_WAYS, fc.ways);
        set(SRC_SERVICES, fc.services);
        set(SRC_STATIONS, fc.stations);
        set(SRC_FOOTPRINTS, fc.footprints);
        set(SRC_PLATFORMS, fc.platforms);
        set(SRC_FACILITIES, fc.facilities);
        set(SRC_LANES, fc.lanes);
        set(SRC_LANE_MARKINGS, fc.laneMarkings);
        set(SRC_LANE_ARROWS, fc.laneArrows);
        set(SRC_JUNCTIONS, fc.junctions);
        set(SRC_CONNECTORS, fc.connectors);
        set(SRC_WAY_LABELS, fc.wayLabels);

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
    });
  });
}
