import type { Map as MLMap } from 'maplibre-gl';
import { iconName } from '@transitmapper/core/render/iconName';
import { type IconName } from '../ui/Icon';
import { ICON_NODES, type IconNode } from './lucideIconNodes';

// On-map pictograms, rasterized at runtime from the same Lucide icon
// vocabulary the React UI's <Icon/> uses (see ui/Icon.tsx) — one icon set,
// not two to keep in sync. Regular (non-SDF) images: color is baked in per
// registered image rather than tinted via icon-color, since every caller here
// wants a fixed catalog color, not a per-feature one.
const ICON_PX = 48; // registered image resolution; icon-size scales it down/up

// Lucide icons are always defined in a 24x24 viewBox (see
// lucide-react/dist/esm/defaultAttributes.mjs) — the same coordinate space
// the old hand-drawn PATHS used, so this scale factor still holds.
const VIEWBOX = 24;
const registeredDisplayColors = new WeakMap<MLMap, Map<string, string>>();

/** Draws one [tag, attrs] shape onto `ctx` in its own local space (the 0-24
 *  Lucide viewBox) — Lucide icons are built from exactly these 7 tag types
 *  across the whole set (verified against every icon in the package), so
 *  this is exhaustive, not a subset. */
function drawShape(
  ctx: CanvasRenderingContext2D,
  [tag, attrs]: IconNode[number],
  fill: boolean,
): void {
  const num = (attr: string) => Number(attrs[attr] ?? 0);
  if (tag === 'path') {
    const path = new Path2D(attrs.d);
    if (fill) ctx.fill(path);
    else ctx.stroke(path);
    return;
  }
  ctx.beginPath();
  switch (tag) {
    case 'circle':
      ctx.arc(num('cx'), num('cy'), num('r'), 0, Math.PI * 2);
      break;
    case 'ellipse':
      ctx.ellipse(num('cx'), num('cy'), num('rx'), num('ry'), 0, 0, Math.PI * 2);
      break;
    case 'line':
      ctx.moveTo(num('x1'), num('y1'));
      ctx.lineTo(num('x2'), num('y2'));
      break;
    case 'rect':
      ctx.rect(num('x'), num('y'), num('width'), num('height'));
      break;
    case 'polyline':
    case 'polygon': {
      const pts = (attrs.points ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      for (let i = 0; i < pts.length; i += 2) {
        if (i === 0) ctx.moveTo(pts[i], pts[i + 1]);
        else ctx.lineTo(pts[i], pts[i + 1]);
      }
      if (tag === 'polygon') ctx.closePath();
      break;
    }
    default:
      return;
  }
  if (fill) ctx.fill();
  else ctx.stroke();
}

function rasterize(name: IconName, color: string, fill: boolean): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(ICON_PX / VIEWBOX, ICON_PX / VIEWBOX);
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  for (const shape of ICON_NODES[name]) drawShape(ctx, shape, fill);
  return ctx.getImageData(0, 0, ICON_PX, ICON_PX).data;
}

// iconName itself lives in core (render/iconName.ts) — buildFeatures runs
// there now and needs to name images without a DOM to rasterize them into.
// Re-exported here so this module stays the one place the app asks about icons.
export { iconName };

export interface EnsureIconOptions {
  /** Raster ink can change with the map theme without changing the canonical
   * image ID stamped into GeoJSON features. */
  displayColor?: string;
  fill?: boolean;
}

/** Registers an icon image once per (glyph, color) pair; safe to call
 *  repeatedly (e.g. once per feature build) — a no-op once registered.
 *  `pathKey` stays a plain string, not `IconName`: callers like
 *  catalogStyle.ts's facilityRender live in packages/core, which can't (and
 *  shouldn't) know about this app's icon vocabulary — the guard below is
 *  what the old hand-drawn version's `if (d) ...` used to do for the same
 *  reason, just against a real icon set instead of PATHS. */
export function ensureIcon(
  map: MLMap,
  pathKey: string,
  color: string,
  opts?: EnsureIconOptions,
): string {
  const name = iconName(pathKey, color);
  const displayColor = opts?.displayColor ?? color;
  const mapColors = registeredDisplayColors.get(map) ?? new Map<string, string>();
  registeredDisplayColors.set(map, mapColors);
  if (map.hasImage(name) && mapColors.get(name) !== displayColor) map.removeImage(name);
  if (!map.hasImage(name)) {
    const node = (ICON_NODES as Record<string, IconNode | undefined>)[pathKey];
    if (node) {
      map.addImage(name, {
        width: ICON_PX,
        height: ICON_PX,
        data: rasterize(pathKey as IconName, displayColor, opts?.fill ?? false),
      });
      mapColors.set(name, displayColor);
    }
  }
  return name;
}
