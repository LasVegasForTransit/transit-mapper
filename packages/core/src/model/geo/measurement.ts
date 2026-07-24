import type { LngLat, Way } from "../system";
import { bearingDegrees, haversineMeters, toRad } from "./spherical";
import { resolveWayPath } from "./wayPath";

/** Total length of a polyline, in meters. */
export function pathLengthMeters(path: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineMeters(path[i - 1], path[i]);
  return total;
}

export function wayLengthMeters(way: Way): number {
  return pathLengthMeters(resolveWayPath(way));
}

/** The segment straddling normalized arc-length t ∈ [0,1] along a polyline,
 *  plus the interpolation fraction within it — the shared walk behind both
 *  pointAtT and bearingAtT. `totalMeters`, when the caller already has it
 *  (e.g. a cached pattern geometry), skips a redundant O(n) haversine sum;
 *  otherwise it's computed here. */
function segmentAtT(path: LngLat[], t: number, totalMeters?: number): { a: LngLat; b: LngLat; f: number } | null {
  if (path.length < 2) return null;
  const total = totalMeters ?? pathLengthMeters(path);
  if (total === 0) return null;
  const target = Math.max(0, Math.min(1, t)) * total;
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = haversineMeters(path[i - 1], path[i]);
    if (acc + seg >= target || i === path.length - 1) {
      const f = seg === 0 ? 0 : (target - acc) / seg;
      return { a: path[i - 1], b: path[i], f };
    }
    acc += seg;
  }
  return null; // unreachable — the loop always returns on its final iteration
}

/** Coordinate at normalized arc-length t ∈ [0,1] along a polyline. Pass
 *  `totalMeters` when the caller already has it cached, to skip
 *  recomputing pathLengthMeters. */
export function pointAtT(path: LngLat[], t: number, totalMeters?: number): LngLat {
  if (path.length === 0) return [0, 0];
  if (path.length === 1) return path[0];
  const seg = segmentAtT(path, t, totalMeters);
  if (!seg) return path[0];
  return [seg.a[0] + (seg.b[0] - seg.a[0]) * seg.f, seg.a[1] + (seg.b[1] - seg.a[1]) * seg.f];
}

/** Compass bearing in degrees (0 = north, clockwise) of a polyline's
 *  direction of travel at normalized arc-length position t ∈ [0,1] — the
 *  segment straddling t, or the path's last segment past its end. Used to
 *  rotate a vehicle's rendered footprint to face its direction of travel.
 *  Reuses the same great-circle bearingDegrees the way-drawing bearing
 *  readout already uses, rather than a separate flat approximation. Pass
 *  `totalMeters` when the caller already has it cached. */
export function bearingAtT(path: LngLat[], t: number, totalMeters?: number): number {
  const seg = segmentAtT(path, t, totalMeters);
  if (!seg) return 0;
  return bearingDegrees(seg.a, seg.b);
}

/** Prefix-sum of segment lengths, in meters: `cum[0] = 0`, `cum[i]` is the
 *  summed length of the first `i` segments, and `cum[path.length - 1]` is the
 *  whole path length. Precompute ONCE per path (same haversine metric as
 *  pathLengthMeters, so it matches pointAtT exactly), then position lookups
 *  become O(log n) binary searches instead of O(n) re-walks — see
 *  pointAtDistance. Used by the vehicle sim, which resolves a position for
 *  every vehicle every tick and must not re-walk a dense (hundreds of points)
 *  path each time. */
export function cumulativeLengths(path: LngLat[]): Float64Array {
  const cum = new Float64Array(path.length);
  for (let i = 1; i < path.length; i++) cum[i] = cum[i - 1] + haversineMeters(path[i - 1], path[i]);
  return cum;
}

/** Coordinate at arc-length `distMeters` from a path's start, using a
 *  precomputed cumulative-length table (see cumulativeLengths). Binary-searches
 *  the table — O(log n), zero trig per call — then linearly interpolates within
 *  the found segment; clamps to the path ends. The hot-path counterpart to
 *  pointAtT for callers that already know the DISTANCE (e.g. the vehicle sim):
 *  it skips both pointAtT's own full-path re-walk and its internal
 *  pathLengthMeters call, and produces the identical coordinate. */
export function pointAtDistance(path: LngLat[], cum: Float64Array, distMeters: number): LngLat {
  const n = path.length;
  if (n === 0) return [0, 0];
  if (n === 1) return path[0];
  const total = cum[n - 1];
  if (total === 0) return path[0];
  const target = Math.max(0, Math.min(total, distMeters));
  // Largest index `lo` with cum[lo] <= target — segment lo..lo+1 holds target.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= n - 1) return path[n - 1];
  const segLen = cum[lo + 1] - cum[lo];
  const f = segLen === 0 ? 0 : (target - cum[lo]) / segLen;
  const a = path[lo];
  const b = path[lo + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

export interface NearestOnPath {
  /** Normalized arc-length position [0,1] of the closest point. */
  t: number;
  coord: LngLat;
  distMeters: number;
}

/** The closest point on a polyline to a coordinate. */
export function nearestOnPath(path: LngLat[], coord: LngLat): NearestOnPath | null {
  if (path.length < 2) return null;
  const total = pathLengthMeters(path);
  let acc = 0;
  let best: NearestOnPath | null = null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const { point, f } = projectOnSegment(coord, a, b);
    const d = haversineMeters(coord, point);
    if (best === null || d < best.distMeters) {
      const seg = haversineMeters(a, b);
      const t = total === 0 ? 0 : (acc + seg * f) / total;
      best = { t, coord: point, distMeters: d };
    }
    acc += haversineMeters(a, b);
  }
  return best;
}

// Project a point onto a segment in a local planar approximation (good enough
// at city scale). Returns the closest point and its fraction f ∈ [0,1].
export function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): { point: LngLat; f: number } {
  const latScale = Math.cos(toRad((a[1] + b[1]) / 2));
  const ax = a[0] * latScale;
  const ay = a[1];
  const bx = b[0] * latScale;
  const by = b[1];
  const px = p[0] * latScale;
  const py = p[1];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let f = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  f = Math.max(0, Math.min(1, f));
  return { point: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], f };
}
