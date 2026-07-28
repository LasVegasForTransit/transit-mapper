import type { Map as MLMap } from 'maplibre-gl';
import { systemSvg } from '@transitmapper/core/render/svg';
import { fitBounds, metersPerPixel, type Viewport } from '@transitmapper/core/render/project';
import { scaleBarFor } from '@transitmapper/core/render/scaleBar';
import type { ViewOptions } from '../map/layers';
import { getMap } from '../map/mapRef';
import { systemBounds } from '@transitmapper/core/model/geo';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';
import { legendEntriesFor, type LegendEntry } from './exportLegend';
import { scaleBarSpec } from './exportScale';
import { singleFlight } from './singleFlight';
import { renderSvgInWorker } from './svgWorker';

// The browser half of SVG export. The composition itself lives in core
// (render/svg.ts) — this supplies the things only a live map knows: how big
// the viewport is, how to project a coordinate, which way is north, and what
// a pixel measures on the ground.

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface SvgComposeOptions {
  title: string;
  legend: LegendEntry[];
}

function flatViewportForMap(map: MLMap): Viewport {
  const container = map.getContainer();
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    width: container.clientWidth,
    height: container.clientHeight,
  };
}

/** Vector export of the schematic, projected through the *given* map's own
 *  project() — pass the export dialog's own preview map instance (already
 *  framed to the whole system) rather than always reading the live app map,
 *  so the SVG matches whatever framing the user chose. */
export function svgMarkup(
  system: TransitSystem,
  view: ViewOptions,
  map: MLMap,
  opts: SvgComposeOptions,
): string {
  const container = map.getContainer();
  const width = container.clientWidth;
  const height = container.clientHeight;
  return systemSvg(system, view, (lngLat: LngLat) => map.project(lngLat as [number, number]), {
    title: opts.title,
    legend: opts.legend,
    width,
    height,
    bearing: map.getBearing(),
    scaleBar: scaleBarSpec(map, Math.min(140, width * 0.3)),
  });
}

/** Export from an already-framed map (e.g. the export dialog's own preview
 *  instance) — no bounds-fitting, whatever that map currently shows is what
 *  gets exported. */
export function exportSvgFromMap(
  system: TransitSystem,
  view: ViewOptions,
  map: MLMap,
  opts: SvgComposeOptions,
  filename = 'transit-system.svg',
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException('SVG export was canceled.', 'AbortError'),
    );
  }
  const container = map.getContainer();

  // ExportPreviewMap disables rotation and pitch, so its camera can use core's
  // MapLibre-compatible pure Web Mercator projector in a Worker. Keep the
  // exact live-map fallback for older callers that deliberately rotate a map;
  // visual fidelity is more important than moving that unusual case off-thread.
  if (map.getBearing() !== 0 || map.getPitch() !== 0) {
    downloadBlob(
      new Blob([svgMarkup(system, view, map, opts)], { type: 'image/svg+xml' }),
      filename,
    );
    return Promise.resolve();
  }

  return renderSvgInWorker(
    {
      system,
      view,
      viewport: flatViewportForMap(map),
      options: {
        title: opts.title,
        legend: opts.legend,
        width: container.clientWidth,
        height: container.clientHeight,
        bearing: 0,
        scaleBar: scaleBarSpec(map, Math.min(140, container.clientWidth * 0.3)),
      },
    },
    { signal },
  ).then((markup) => {
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('SVG export was canceled.', 'AbortError');
    }
    downloadBlob(new Blob([markup], { type: 'image/svg+xml' }), filename);
  });
}

/** Quick-export path: fit a pure north-up viewport and render it in a Worker.
 * It neither blocks input with buildFeatures/systemSvg nor disturbs the live
 * editor camera. Repeated shortcuts share a latest-wins single-flight lane. */
export function exportFullSystemSvg(
  system: TransitSystem,
  view: ViewOptions,
  filename = 'transit-system.svg',
): void {
  fullSystemSvgFlight.call(system, view, filename);
}

const fullSystemSvgFlight = singleFlight(
  async (system: TransitSystem, view: ViewOptions, filename: string): Promise<void> => {
    const liveContainer = getMap()?.getContainer();
    const width =
      liveContainer && liveContainer.clientWidth > 0 ? liveContainer.clientWidth : 1_600;
    const height =
      liveContainer && liveContainer.clientHeight > 0 ? liveContainer.clientHeight : 1_000;
    const bounds = systemBounds(system);
    const viewport = bounds
      ? fitBounds(bounds, { width, height, padding: 56 })
      : { center: system.viewport.center, zoom: system.viewport.zoom, width, height };
    try {
      const markup = await renderSvgInWorker({
        system,
        view,
        viewport,
        options: {
          title: system.name || 'Transit system',
          legend: legendEntriesFor(system, view),
          width,
          height,
          bearing: 0,
          scaleBar: scaleBarFor(metersPerPixel(viewport), Math.min(140, width * 0.3)),
        },
      });
      downloadBlob(new Blob([markup], { type: 'image/svg+xml' }), filename);
    } catch (error) {
      console.error('SVG export failed:', error);
    }
  },
);
