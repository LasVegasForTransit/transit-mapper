import type { Map as MLMap } from 'maplibre-gl';
import { fitBounds, metersPerPixel } from '@transitmapper/core/render/project';
import { scaleBarFor } from '@transitmapper/core/render/scaleBar';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import { getMap } from '../map/mapRef';
import { systemBounds } from '@transitmapper/core/model/geo';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { legendEntriesFor, type LegendEntry } from './exportLegend';
import { scaleBarSpec } from './exportScale';
import { singleFlight } from './singleFlight';
import { renderSvgInWorker } from './svgWorker';
import { svgViewForFittedMap, svgViewForViewport } from './svg-render-view';
import type { GroundPlaneProjection, GroundPlaneProjectionAnchor } from './svg-worker-projector';

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

interface ExportSvgFromMapOptions extends SvgComposeOptions {
  filename?: string;
  signal?: AbortSignal;
}

function groundPlaneProjectionForMap(map: MLMap): GroundPlaneProjection {
  const container = map.getContainer();
  const center = map.getCenter();
  const samples: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ] = [
    [0, 0],
    [container.clientWidth, 0],
    [0, container.clientHeight],
    [container.clientWidth, container.clientHeight],
  ];
  const anchorAt = ([x, y]: readonly [number, number]): GroundPlaneProjectionAnchor => {
    const coordinate = map.unproject([x, y]);
    return {
      coordinate: [coordinate.lng, coordinate.lat],
      point: { x, y },
    };
  };
  return {
    centerLongitude: center.lng,
    anchors: [
      anchorAt(samples[0]),
      anchorAt(samples[1]),
      anchorAt(samples[2]),
      anchorAt(samples[3]),
    ],
  };
}

/** Export from an already-framed map (e.g. the export dialog's own preview
 *  instance) — no bounds-fitting, whatever that map currently shows is what
 *  gets exported. */
export function exportSvgFromMap(
  system: TransitSystem,
  view: ViewOptions,
  map: MLMap,
  options: ExportSvgFromMapOptions,
): Promise<void> {
  const { filename = 'transit-system.svg', signal } = options;
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException('SVG export was canceled.', 'AbortError'),
    );
  }
  const container = map.getContainer();
  const renderView = svgViewForFittedMap(view, map);

  return renderSvgInWorker(
    {
      system,
      view: renderView,
      projection: groundPlaneProjectionForMap(map),
      options: {
        title: options.title,
        legend: options.legend,
        width: container.clientWidth,
        height: container.clientHeight,
        bearing: map.getBearing(),
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
    const renderView = svgViewForViewport(view, viewport);
    try {
      const markup = await renderSvgInWorker({
        system,
        view: renderView,
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
