import type { Map as MLMap } from 'maplibre-gl';
import { systemSvg } from '@transitmapper/core/render/svg';
import type { ViewOptions } from '../map/layers';
import { getMap } from '../map/mapRef';
import { systemBounds } from '@transitmapper/core/model/geo';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';
import { legendEntriesFor, type LegendEntry } from './exportLegend';
import { scaleBarSpec } from './exportScale';

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
): void {
  downloadBlob(new Blob([svgMarkup(system, view, map, opts)], { type: 'image/svg+xml' }), filename);
}

/** Quick-export path: temporarily fit the live app map to the whole system's
 *  extent, export with title/legend, then restore the camera — mirrors
 *  exportFullSystemPng (see share/pngExport.ts). */
export function exportFullSystemSvg(
  system: TransitSystem,
  view: ViewOptions,
  filename = 'transit-system.svg',
): void {
  const map = getMap();
  if (!map) return;
  const prev = {
    center: map.getCenter(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
  const bounds = systemBounds(system);
  if (bounds) map.fitBounds(bounds, { padding: 56, animate: false });
  map.once('idle', () => {
    exportSvgFromMap(
      system,
      view,
      map,
      { title: system.name || 'Transit system', legend: legendEntriesFor(system, view) },
      filename,
    );
    map.jumpTo(prev);
  });
  map.triggerRepaint();
}
