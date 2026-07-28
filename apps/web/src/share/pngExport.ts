import type { Map as MLMap } from 'maplibre-gl';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { ViewOptions } from '../map/layers';
import { getMap } from '../map/mapRef';
import { renderSystemForExport } from '../map/export/exportRenderer';
import { waitForExportFrame } from './exportOperation';
import { singleFlight } from './singleFlight';
import { legendEntriesFor, type LegendEntry } from './exportLegend';
import { scaleBarSpec } from './exportScale';
import { canvasToPngBlob } from './previewImage';

const INK = '#191a17';
const PAD = 20; // export-canvas padding, independent of the app's 4px UI grid (this is print/image space)
const TITLE_SIZE = 22;
const SWATCH = 14;
const ROW_H = 22;

export interface ComposeOptions {
  title: string;
  legend: LegendEntry[];
}

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

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  map: MLMap,
  out: HTMLCanvasElement,
  scale: number,
): void {
  const maxWidthPx = Math.min(140, (out.width / scale) * 0.3);
  const { widthPx, label } = scaleBarSpec(map, maxWidthPx);
  const w = widthPx * scale;
  const x0 = out.width - PAD * scale - w;
  const y = out.height - PAD * scale - 6 * scale;
  const tick = 5 * scale;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x0 + w, y);
  ctx.moveTo(x0, y - tick);
  ctx.lineTo(x0, y + tick);
  ctx.moveTo(x0 + w, y - tick);
  ctx.lineTo(x0 + w, y + tick);
  ctx.stroke();
  ctx.font = `600 ${11 * scale}px system-ui, sans-serif`;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, x0 + w / 2, y - tick - 4 * scale);
  ctx.restore();
}

function drawNorthArrow(
  ctx: CanvasRenderingContext2D,
  map: MLMap,
  out: HTMLCanvasElement,
  scale: number,
): void {
  const cx = out.width - PAD * scale - 10 * scale;
  const cy = PAD * scale + 18 * scale;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-map.getBearing() * Math.PI) / 180);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(0, -12 * scale);
  ctx.lineTo(6 * scale, 8 * scale);
  ctx.lineTo(0, 3.5 * scale);
  ctx.lineTo(-6 * scale, 8 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.font = `700 ${11 * scale}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('N', 0, 22 * scale);
  ctx.restore();
}

/** Draws the title (top-left), a line-color legend (bottom-left), a north
 *  arrow (top-right), and a scale bar (bottom-right) onto a copy of the
 *  map's rendered canvas — the same visual treatment an MTA-style
 *  wayfinding map uses, composited at export time so the live preview stays a
 *  cheap HTML overlay (see ExportPreviewMap) instead of redrawing on every frame. */
function composeCanvas(
  src: HTMLCanvasElement,
  map: MLMap,
  opts: ComposeOptions,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d');
  if (!ctx) return src;
  const scale = window.devicePixelRatio || 1;

  ctx.drawImage(src, 0, 0);

  if (opts.title.trim()) {
    ctx.font = `700 ${TITLE_SIZE * scale}px system-ui, sans-serif`;
    const w = ctx.measureText(opts.title).width;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(0, 0, w + PAD * 2 * scale, TITLE_SIZE * scale + PAD * 1.6 * scale);
    ctx.fillStyle = INK;
    ctx.textBaseline = 'top';
    ctx.fillText(opts.title, PAD * scale, PAD * 0.8 * scale);
  }

  if (opts.legend.length > 0) {
    const rowH = ROW_H * scale;
    const panelH = opts.legend.length * rowH + PAD * scale;
    ctx.font = `500 ${13 * scale}px system-ui, sans-serif`;
    const maxLabelW = Math.max(...opts.legend.map((e) => ctx.measureText(e.label).width));
    const panelW = SWATCH * scale + 10 * scale + maxLabelW + PAD * 2 * scale;
    const top = out.height - panelH;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(0, top, panelW, panelH);
    opts.legend.forEach((entry, i) => {
      const y = top + PAD * 0.5 * scale + i * rowH;
      ctx.fillStyle = entry.color;
      ctx.fillRect(PAD * scale, y + (rowH - SWATCH * scale) / 2, SWATCH * scale, SWATCH * scale);
      ctx.fillStyle = INK;
      ctx.textBaseline = 'middle';
      ctx.fillText(entry.label, PAD * scale + SWATCH * scale + 10 * scale, y + rowH / 2);
    });
  }

  drawNorthArrow(ctx, map, out, scale);
  drawScaleBar(ctx, map, out, scale);

  return out;
}

/** Capture an already-framed map (e.g. the export dialog's own preview
 *  instance) as a PNG, with the title/legend composited on top. */
export async function exportPngFromMap(
  map: MLMap,
  opts: ComposeOptions,
  filename = 'transit-system.png',
  signal?: AbortSignal,
): Promise<void> {
  await waitForExportFrame(map, { signal });
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Export was canceled.', 'AbortError');
  }
  const blob = await canvasToPngBlob(composeCanvas(map.getCanvas(), map, opts), { signal });
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Export was canceled.', 'AbortError');
  }
  if (!blob) throw new Error('The browser could not encode the PNG export.');
  downloadBlob(blob, filename);
}

/** Quick-export path: render the whole system's extent on a dedicated OFFSCREEN
 *  map (map/export/exportRenderer.ts), composite title/legend, and download —
 *  so "Export PNG" from the quick menu shows the whole network (MTA-map style).
 *  Rendering offscreen (rather than borrowing the live map) means the live map
 *  no longer needs preserveDrawingBuffer, and export never disturbs the user's
 *  camera. Fire-and-forget, mirroring the prior idle-callback behavior. */
export function exportFullSystemPng(
  system: TransitSystem,
  view: ViewOptions,
  filename = 'transit-system.png',
): void {
  fullSystemPngFlight.call(system, view, filename);
}

// Gated so a held "c" cannot stack offscreen WebGL contexts — see
// share/singleFlight.ts for why the extra presses are coalesced rather than
// dropped. Module-level, so the keyboard shortcut and the Export button share
// one gate instead of racing each other.
const fullSystemPngFlight = singleFlight(
  async (system: TransitSystem, view: ViewOptions, filename: string): Promise<void> => {
    // Match the live map's aspect when we can, so the framing feels familiar.
    const live = getMap();
    const container = live?.getContainer();
    const size =
      container && container.clientWidth > 0
        ? { width: container.clientWidth, height: container.clientHeight }
        : undefined;
    try {
      const rendered = await renderSystemForExport(system, view, size ?? {});
      try {
        const composed = composeCanvas(rendered.canvas, rendered.map, {
          title: system.name || 'Transit system',
          legend: legendEntriesFor(system, view),
        });
        const blob = await canvasToPngBlob(composed);
        if (!blob) throw new Error('The browser could not encode the PNG export.');
        downloadBlob(blob, filename);
      } finally {
        rendered.dispose();
      }
    } catch (e) {
      console.error('PNG export failed:', e);
    }
  },
);
