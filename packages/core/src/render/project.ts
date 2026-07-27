import type { LngLat } from '../model/system';

// Web Mercator projection, matching MapLibre's own conventions exactly (512px
// tiles, zoom as a log2 scale factor) so a system framed here lands where it
// would in the app. The browser has map.project() for this; the Worker has no
// map, so it has this instead — the same math with the map taken out.
//
// Pitch and bearing are deliberately absent. Server-rendered output (preview
// images, static embed fallbacks) is always north-up and flat; supporting a
// tilted camera would mean reimplementing MapLibre's whole transform for a
// case nothing asks for.

const TILE_SIZE = 512;
const MAX_MERCATOR_LAT = 85.051129; // where the mercator projection runs to infinity

/** Screen-space point, in the same CSS-pixel space MapLibre's project() uses. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** A north-up, unpitched camera over a viewport of a known pixel size. */
export interface Viewport {
  center: LngLat;
  zoom: number;
  width: number;
  height: number;
}

/** Projects a lng/lat onto the unit square, where (0,0) is the northwest
 *  corner of the world and (1,1) the southeast. Zoom-independent. */
function mercator(lngLat: LngLat): ScreenPoint {
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lngLat[1]));
  const latRad = (lat * Math.PI) / 180;
  return {
    x: (lngLat[0] + 180) / 360,
    y: 0.5 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / (2 * Math.PI),
  };
}

/** Inverse of `mercator`. */
function unmercator(point: ScreenPoint): LngLat {
  const lngDeg = point.x * 360 - 180;
  const latRad = 2 * (Math.atan(Math.exp((0.5 - point.y) * 2 * Math.PI)) - Math.PI / 4);
  return [lngDeg, (latRad * 180) / Math.PI];
}

/** Builds the lngLat -> pixel function for a viewport. Shaped as a callback
 *  rather than a method so callers can hand render/svg.ts either this or
 *  MapLibre's own bound project() and get identical output. */
export function projector(viewport: Viewport): (lngLat: LngLat) => ScreenPoint {
  const worldSize = TILE_SIZE * 2 ** viewport.zoom;
  const origin = mercator(viewport.center);
  return (lngLat: LngLat) => {
    const p = mercator(lngLat);
    return {
      x: (p.x - origin.x) * worldSize + viewport.width / 2,
      y: (p.y - origin.y) * worldSize + viewport.height / 2,
    };
  };
}

export interface FitBoundsOptions {
  width: number;
  height: number;
  /** Pixels of breathing room kept between the content and every edge. */
  padding: number;
  /** Ceiling on the derived zoom. A single-station system has zero extent and
   *  would otherwise fit at infinite zoom; this is what stops that. */
  maxZoom?: number;
}

/**
 * Derives the camera that frames `bounds` inside a viewport — the pure
 * equivalent of MapLibre's fitBounds, for callers that have no map to call it
 * on. Returns the tightest fit that keeps the whole extent inside the padded
 * viewport on both axes.
 */
export function fitBounds(bounds: [LngLat, LngLat], opts: FitBoundsOptions): Viewport {
  const sw = mercator(bounds[0]);
  const ne = mercator(bounds[1]);
  const spanX = Math.abs(ne.x - sw.x);
  const spanY = Math.abs(ne.y - sw.y);

  const usableWidth = Math.max(1, opts.width - opts.padding * 2);
  const usableHeight = Math.max(1, opts.height - opts.padding * 2);

  // A zero span on an axis imposes no constraint (Infinity), so the other axis
  // decides; if both are zero, maxZoom does.
  const scaleX = spanX > 0 ? usableWidth / (spanX * TILE_SIZE) : Infinity;
  const scaleY = spanY > 0 ? usableHeight / (spanY * TILE_SIZE) : Infinity;
  const scale = Math.min(scaleX, scaleY);

  const maxZoom = opts.maxZoom ?? 16;
  const zoom = Number.isFinite(scale) ? Math.min(maxZoom, Math.log2(scale)) : maxZoom;

  return {
    center: unmercator({ x: (sw.x + ne.x) / 2, y: (sw.y + ne.y) / 2 }),
    zoom,
    width: opts.width,
    height: opts.height,
  };
}

/**
 * Ground resolution at a viewport's center, in meters per pixel — what a scale
 * bar needs. Mercator distorts with latitude, so this is only accurate near
 * the center, which is exactly where a scale bar claims to apply.
 */
export function metersPerPixel(viewport: Viewport): number {
  const EQUATOR_METERS = 40075016.686;
  const worldSize = TILE_SIZE * 2 ** viewport.zoom;
  return (EQUATOR_METERS * Math.cos((viewport.center[1] * Math.PI) / 180)) / worldSize;
}
