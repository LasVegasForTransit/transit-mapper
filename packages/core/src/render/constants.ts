import { iconName } from './iconName';

// The DOM-free half of the map layer constants. The MapLibre source/layer id
// vocabulary (SRC_*/LYR_*) and the paint expressions stay in the web app —
// they only mean something to a live MapLibre style. What lives here is what
// buildFeatures itself stamps onto features, so the Worker gets the same
// values without pulling in a map.

// Reshape/physical handles are always this one color+glyph (a solid square —
// the standard vector-editor "this is a control point" shape) regardless of
// what they're attached to, so they read as one consistent tool affordance
// and never as a real object like a stop or facility.
export const HANDLE_INK = '#191a17';
export const HANDLE_ICON = iconName('square', HANDLE_INK);

// meters-per-pixel at zoom 14 on a 512px-tile web-mercator map; lane widths
// are stored in meters, so each feature carries its z14 pixel width and the
// layer scales it exponentially (base 2 — exact for mercator) with zoom.
const MPP_Z14_EQUATOR = 40075016.686 / (512 * 2 ** 14);
export function widthPxAtZ14(widthM: number, lat: number): number {
  return widthM / (MPP_Z14_EQUATOR * Math.cos((lat * Math.PI) / 180));
}
