// Import-time corridor conflation: detecting when a newly-imported shape (a
// GTFS route's polyline) runs along ALREADY-existing compatible infrastructure
// for some interior stretch, so it can share that Way instead of creating
// duplicate overlapping geometry. Pure and network-free like the rest of
// geo/ — no store, no side effects.
//
// This supplies the interior matching that routing-edits' endpoint-snapped,
// corridor-biased Dijkstra cannot: routes may share a middle trunk while
// diverging at both ends, so neither endpoint lands near the shared Way.

import { bearingDegrees, haversineMeters } from './spherical';
import { projectOnSegment } from './measurement';
import { candidateWayIdsNear } from './snapIndex';
import { resolveWayPath, wayById } from './wayPath';
import type { LngLat, Way } from '../system';

/** A stretch of the new shape that runs along an already-existing way. */
export interface OnWayRun {
  onWayId: string;
  /** Segment-index range on the shape's own path: covers points [fromIdx, toIdx]. */
  fromIdx: number;
  toIdx: number;
}

/** A stretch of the new shape with no nearby compatible existing way — new infrastructure. */
export interface FreshRun {
  fresh: true;
  fromIdx: number;
  toIdx: number;
}

export type ShapeRun = OnWayRun | FreshRun;

export interface DetectRunsOptions {
  /** Max distance (meters) between the new shape and a candidate way to count
   *  as running along it. ~20m: comfortably inside "same street" (absorbs a
   *  GTFS shape digitized along the curb lane vs. a centerline-traced way,
   *  plus ordinary GPS/digitizing slop) and comfortably outside "next street"
   *  (real street-grid block spacing is tens of meters at minimum). */
  toleranceM?: number;
  /** Max heading difference (degrees, 0-180) between the new shape's local
   *  direction and the candidate way's local direction. ~40°: absorbs corner-
   *  fillet interpolation and GPS jitter while still rejecting a crossing
   *  street (~90° off) and an opposing carriageway (~180° off) of a divided
   *  road narrower than `toleranceM`. */
  headingToleranceDeg?: number;
  /** A matched run shorter than this (meters) is discarded back to fresh — a
   *  coincidental crossing-street blip, not a real shared stretch. Set just
   *  above `toleranceM` itself: a single intersection crossing produces a
   *  match shorter than one tolerance-radius; a real shared stretch is longer
   *  than the tolerance that produced it. */
  minRunM?: number;
  /** A fresh gap of at most this length (meters) sandwiched between two runs
   *  on the SAME way gets bridged into one run — intersection-width corner
   *  noise, not a real transition. ~30m: the rough scale of an arterial
   *  intersection's curb-to-curb width plus turn lanes. A gap between runs on
   *  DIFFERENT ways, or longer than this, is left as a real fresh stretch. */
  gapBridgeM?: number;
}

export const CONFLATION_TOLERANCE_M = 20;
export const CONFLATION_HEADING_TOLERANCE_DEG = 40;
export const CONFLATION_MIN_RUN_M = 25;
export const CONFLATION_GAP_BRIDGE_M = 30;

/** Circular heading difference folded into [0, 180]. */
function headingDeltaDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** The nearest point on `way`'s own path to `coord`, plus that nearest
 *  segment's own local heading (for direction-alignment checks). Built from
 *  already-exported primitives — does not touch `nearestOnPath`'s signature,
 *  which every existing caller (`snap`, station reanchoring) depends on. */
function nearestWaySegment(
  way: Way,
  coord: LngLat,
): { point: LngLat; distMeters: number; headingDeg: number } | null {
  const path = resolveWayPath(way);
  if (path.length < 2) return null;
  let best: { point: LngLat; distMeters: number; headingDeg: number } | null = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const { point } = projectOnSegment(coord, a, b);
    const d = haversineMeters(coord, point);
    if (best === null || d < best.distMeters)
      best = { point, distMeters: d, headingDeg: bearingDegrees(a, b) };
  }
  return best;
}

/** Which existing way (if any) segment [a,b] of the new shape runs along:
 *  both endpoints must project within `toleranceM` of the SAME candidate way,
 *  with that way's local heading within `headingToleranceDeg` of the shape
 *  segment's own heading. Ties broken by closest. */
function matchOneSegment(
  a: LngLat,
  b: LngLat,
  candidateWays: Way[],
  byId: Map<string, Way>,
  toleranceM: number,
  headingToleranceDeg: number,
): string | null {
  const shapeHeading = bearingDegrees(a, b);
  const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let best: { wayId: string; distMeters: number } | null = null;
  for (const id of candidateWayIdsNear(mid, candidateWays, toleranceM)) {
    const way = byId.get(id);
    if (!way) continue;
    const ma = nearestWaySegment(way, a);
    const mb = nearestWaySegment(way, b);
    if (!ma || !mb) continue;
    const distMeters = Math.max(ma.distMeters, mb.distMeters);
    if (distMeters > toleranceM) continue;
    if (headingDeltaDeg(shapeHeading, ma.headingDeg) > headingToleranceDeg) continue;
    if (headingDeltaDeg(shapeHeading, mb.headingDeg) > headingToleranceDeg) continue;
    if (best === null || distMeters < best.distMeters) best = { wayId: id, distMeters };
  }
  return best?.wayId ?? null;
}

interface RawRun {
  value: string | null;
  segFrom: number;
  segToExcl: number;
  lengthM: number;
}

function groupRuns(values: (string | null)[], segLen: number[]): RawRun[] {
  const out: RawRun[] = [];
  values.forEach((v, i) => {
    const last = out[out.length - 1];
    if (last && last.value === v) {
      last.segToExcl = i + 1;
      last.lengthM += segLen[i];
    } else {
      out.push({ value: v, segFrom: i, segToExcl: i + 1, lengthM: segLen[i] });
    }
  });
  return out;
}

/**
 * Detect which stretches of `path` (a new shape's polyline, e.g. a GTFS
 * pattern's own points) run along already-existing compatible infrastructure
 * (`candidateWays`, pre-filtered by the caller to mode-compatible types), and
 * which are genuinely new. Returns an ordered sequence covering every segment
 * of `path` exactly once. Pure — no mutation, no lookup outside its inputs.
 */
export function detectShapeRuns(
  path: LngLat[],
  candidateWays: Way[],
  opts: DetectRunsOptions = {},
): ShapeRun[] {
  const toleranceM = opts.toleranceM ?? CONFLATION_TOLERANCE_M;
  const headingToleranceDeg = opts.headingToleranceDeg ?? CONFLATION_HEADING_TOLERANCE_DEG;
  const minRunM = opts.minRunM ?? CONFLATION_MIN_RUN_M;
  const gapBridgeM = opts.gapBridgeM ?? CONFLATION_GAP_BRIDGE_M;
  if (path.length < 2 || candidateWays.length === 0) {
    return path.length < 2 ? [] : [{ fresh: true, fromIdx: 0, toIdx: path.length - 1 }];
  }

  const byId = wayById(candidateWays);
  const segLen: number[] = [];
  const rawWayId: (string | null)[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    segLen.push(haversineMeters(path[i], path[i + 1]));
    rawWayId.push(
      matchOneSegment(path[i], path[i + 1], candidateWays, byId, toleranceM, headingToleranceDeg),
    );
  }

  // Discard matched runs shorter than minRunM back to fresh (coincidental
  // crossing-street blips), then re-coalesce (a discarded blip may now sit
  // beside an already-fresh neighbor).
  let runs = groupRuns(rawWayId, segLen);
  for (const r of runs)
    if (r.value !== null && r.lengthM < minRunM && runs.length > 1) r.value = null;
  const expanded: (string | null)[] = [];
  for (const r of runs) for (let i = r.segFrom; i < r.segToExcl; i++) expanded.push(r.value);
  runs = groupRuns(expanded, segLen);

  // Bridge a short fresh gap sandwiched between two runs on the SAME way.
  let bridged = true;
  while (bridged) {
    bridged = false;
    for (let i = 1; i < runs.length - 1; i++) {
      const gap = runs[i];
      const prev = runs[i - 1];
      const next = runs[i + 1];
      if (
        gap.value === null &&
        gap.lengthM <= gapBridgeM &&
        prev.value !== null &&
        prev.value === next.value
      ) {
        prev.segToExcl = next.segToExcl;
        prev.lengthM += gap.lengthM + next.lengthM;
        runs.splice(i, 2);
        bridged = true;
        break;
      }
    }
  }

  return runs.map((r): ShapeRun =>
    r.value === null
      ? { fresh: true, fromIdx: r.segFrom, toIdx: r.segToExcl }
      : { onWayId: r.value, fromIdx: r.segFrom, toIdx: r.segToExcl },
  );
}

/** Longest segment the matcher can judge fairly, as a multiple of the
 *  tolerance. matchOneSegment requires BOTH ends of a segment to sit within
 *  tolerance of the same way, which is a fair test for a segment about as long
 *  as the tolerance and a useless one for a segment a hundred times longer. */
const MAX_MATCH_SEGMENT_TOLERANCES = 2;

/**
 * Split a polyline's long segments so corridor matching can judge them.
 *
 * A GTFS shape carries a point every few metres, so its segments are already
 * far shorter than any tolerance and this does nothing. A hand-drawn way can
 * be two points a kilometre apart — and since a segment only matches when BOTH
 * its ends are near the same way, such a segment is all-or-nothing: a line
 * that runs along a street for half its length and then turns off matches
 * nothing at all. Subdividing lets the part that really does run along the
 * street match, and the part that leaves be fresh.
 *
 * Interpolating in lng/lat rather than along a great circle: at the scale of a
 * few tolerance-widths the difference is far below the tolerance itself.
 */
export function densifyForMatching(path: LngLat[], toleranceM: number): LngLat[] {
  const maxSegM = Math.max(1, toleranceM * MAX_MATCH_SEGMENT_TOLERANCES);
  const out: LngLat[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    out.push(a);
    const steps = Math.ceil(haversineMeters(a, b) / maxSegM);
    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  }
  if (path.length > 0) out.push(path[path.length - 1]);
  return out;
}

/** How far off the straight line between its neighbours a point may sit and
 *  still count as adding nothing. Well under a metre: this only removes points
 *  that densifyForMatching itself interpolated, never a corner someone drew. */
const COLLINEAR_TOLERANCE_M = 0.25;

/**
 * Drop points that lie on the straight line between their neighbours.
 *
 * The companion to densifyForMatching: geometry minted from a densified path
 * would otherwise carry every interpolated point, so a straight line drawn
 * with two clicks would come back with fifty vertices and fifty drag handles.
 */
export function dropCollinearPoints(path: LngLat[]): LngLat[] {
  if (path.length < 3) return path;
  const out: LngLat[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = out[out.length - 1];
    const next = path[i + 1];
    const { point } = projectOnSegment(path[i], prev, next);
    if (haversineMeters(path[i], point) > COLLINEAR_TOLERANCE_M) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}
