// Street-geometry engine, stage 1: real per-lane geometry derived from a
// way's cross-section profile. Pure and network-free — the model stays
// topology (centerline + profile); everything drawable here is DERIVED on
// demand and memoized per way object, the same WeakMap pattern as
// geo.ts's resolveWayPath. Later stages (junction footprints, connector
// curves) build on these lane paths.
//
// Conventions (shared with the model): a profile's lanes run left-to-right
// as seen facing "forward" (increasing point index); a positive perpendicular
// offset is RIGHT of travel — so the first lane sits at the most negative
// offset. See model/system.ts CrossSection and geo.ts offsetPolyline.

import { laneKind } from '../model/catalog';
import {
  cumulativeLengths,
  offsetPolyline,
  patternSegments,
  resolveWayPath,
  serviceLaneOnWay,
  patternLegs,
  stitchPaths,
} from '../model/geo';
import { profileWidthM } from '../model/profile';
import type { LaneDirection, LngLat, Pattern, Way } from '../model/system';

/** One lane's drawable geometry: its centerline, offset from the way's. */
export interface LanePath {
  laneId: string;
  kindId: string;
  direction: LaneDirection;
  widthM: number;
  /** Signed perpendicular offset of the lane's center from the way
   *  centerline, meters; negative = left of forward travel. */
  offsetM: number;
  path: LngLat[];
}

/** A painted line between/beside lanes. */
export interface DividerPath {
  /** laneLine = dashed separator between same-direction lanes;
   *  centerLine = opposing-directions separator (the double yellow);
   *  edgeLine = solid edge of the directional roadway. */
  kind: 'laneLine' | 'centerLine' | 'edgeLine';
  /** Stable semantic boundary identity; geometry and array position can change
   * while these adjacent model-owned lane IDs remain the same. */
  beforeLaneId: string;
  afterLaneId: string;
  path: LngLat[];
}

/** Everything stage 1 derives for one way. */
export interface WayLaneGeometry {
  wayId: string;
  totalWidthM: number;
  lanes: LanePath[];
  dividers: DividerPath[];
  /** Directional lanes' paths oriented ALONG their travel direction —
   *  backward lanes come pre-reversed, so a symbol layer placing arrows
   *  along the line always points them the way traffic moves. Lanes with
   *  direction "both"/"none" aren't included. */
  arrows: LanePath[];
}

/** Crop a polyline by arc length: drop `fromM` meters off the start and
 *  `toM` meters off the end, interpolating the cut points. Returns the
 *  original array when nothing is cropped; an empty array when the crops
 *  consume the whole path. */
export function trimPath(path: LngLat[], fromM: number, toM: number): LngLat[] {
  if ((fromM <= 0 && toM <= 0) || path.length < 2) return path;
  // Same metric as every other length in the pipeline. This used to measure
  // with a flat-earth approximation of its own, so a junction trimmed back by
  // "3 metres" was a slightly different three metres than the three the lane
  // path it cut is measured in.
  const cum = cumulativeLengths(path);
  const total = cum[cum.length - 1];
  const a = Math.max(0, fromM);
  const b = total - Math.max(0, toM);
  if (b - a < 0.05) return [];
  const at = (m: number): LngLat => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < m) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (m - cum[i - 1]) / seg;
    return [
      path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
      path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
    ];
  };
  const out: LngLat[] = [at(a)];
  for (let i = 0; i < path.length; i++) {
    if (cum[i] > a && cum[i] < b) out.push(path[i]);
  }
  out.push(at(b));
  return out;
}

// Cache: per way object, keyed by the trim pair (junction trims change
// independently of the way object when a NEIGHBOR way's profile widens).
const cache = new WeakMap<Way, Map<string, WayLaneGeometry>>();

// The outer WeakMap is keyed per way OBJECT, so entries die with the way. The
// inner map is keyed by a FORMATTED FLOAT, which is an unbounded key space: a
// drag that reshapes a neighbor way changes this way's trim by a fraction of a
// metre per frame, minting a new key every frame and never reusing it. Left
// uncapped, one drag gestures grows this map by one full lane geometry per
// frame for as long as the gesture lasts.
//
// Two slots is the smallest cap that keeps the real hit rate: a way has one
// current trim pair, and the second slot absorbs the transient while a
// neighbour widens (and the alternation between the two viewport extents
// pushData and the selection path each compute). Map preserves insertion
// order, so the oldest key is simply the first one.
const MAX_TRIMS_PER_WAY = 2;

/** Derive (memoized) the full lane-level geometry for one way, with its
 *  ends optionally trimmed back where they meet junction footprints. */
export interface ResolvedWayLaneGeometry {
  geometry: WayLaneGeometry;
  cacheHit: boolean;
}

/** Same geometry contract with truthful cache attribution for the renderer's
 * performance counters. Callers that do not instrument projection keep using
 * `wayLaneGeometry` below. */
export function resolveWayLaneGeometry(
  way: Way,
  trimStartM = 0,
  trimEndM = 0,
): ResolvedWayLaneGeometry {
  let byTrim = cache.get(way);
  if (!byTrim) {
    byTrim = new Map();
    cache.set(way, byTrim);
  }
  const key = `${trimStartM.toFixed(2)}:${trimEndM.toFixed(2)}`;
  const cached = byTrim.get(key);
  if (cached) return { geometry: cached, cacheHit: true };
  while (byTrim.size >= MAX_TRIMS_PER_WAY) {
    const oldest = byTrim.keys().next();
    if (oldest.done) break;
    byTrim.delete(oldest.value);
  }

  const center = trimPath(resolveWayPath(way), trimStartM, trimEndM);
  const lanes: LanePath[] = [];
  const dividers: DividerPath[] = [];
  const arrows: LanePath[] = [];
  const totalWidthM = profileWidthM(way.profile);

  if (center.length >= 2 && way.profile.lanes.length > 0) {
    // Lane centers: cumulative width from the left edge, re-centered on the
    // way centerline.
    let cum = 0;
    for (const lane of way.profile.lanes) {
      const offsetM = cum + lane.widthM / 2 - totalWidthM / 2;
      const path = offsetPolyline(center, offsetM);
      lanes.push({
        laneId: lane.id,
        kindId: lane.kindId,
        direction: lane.direction,
        widthM: lane.widthM,
        offsetM,
        path,
      });
      cum += lane.widthM;
    }

    // Painted lines at boundaries between adjacent DIRECTIONAL lanes (the
    // markings that make a roadway read as lanes): dashed white between
    // same-direction lanes, the "double yellow" where directions oppose.
    // Solid edge lines bound the directional block on each side.
    const specs = way.profile.lanes;
    for (let i = 1; i < specs.length; i++) {
      const prev = specs[i - 1];
      const cur = specs[i];
      {
        const b = specs.slice(0, i).reduce((s, l) => s + l.widthM, 0) - totalWidthM / 2;
        const prevDir = laneKind(prev.kindId).directional;
        const curDir = laneKind(cur.kindId).directional;
        if (prevDir && curDir) {
          const opposing =
            (prev.direction === 'forward' && cur.direction === 'backward') ||
            (prev.direction === 'backward' && cur.direction === 'forward');
          dividers.push({
            kind: opposing ? 'centerLine' : 'laneLine',
            beforeLaneId: prev.id,
            afterLaneId: cur.id,
            path: offsetPolyline(center, b),
          });
        } else if (prevDir !== curDir) {
          dividers.push({
            kind: 'edgeLine',
            beforeLaneId: prev.id,
            afterLaneId: cur.id,
            path: offsetPolyline(center, b),
          });
        }
      }
    }

    // Direction arrows: one path per one-directional lane, oriented along
    // its travel so line-placed symbols point the right way.
    for (const lane of lanes) {
      if (!laneKind(lane.kindId).directional) continue;
      if (lane.direction === 'forward') arrows.push(lane);
      else if (lane.direction === 'backward')
        arrows.push({ ...lane, path: [...lane.path].reverse() });
    }
  }

  const result: WayLaneGeometry = { wayId: way.id, totalWidthM, lanes, dividers, arrows };
  byTrim.set(key, result);
  return { geometry: result, cacheHit: false };
}

export function wayLaneGeometry(way: Way, trimStartM = 0, trimEndM = 0): WayLaneGeometry {
  return resolveWayLaneGeometry(way, trimStartM, trimEndM).geometry;
}

/**
 * The polyline a service actually rides along `pattern`'s full route — one
 * stitched lane centerline per way (via serviceLaneOnWay/wayLaneGeometry),
 * concatenated the same way patternPath stitches plain way centerlines. A lane
 * path always follows its way's own stored point order, so it is reversed here
 * for any way the pattern travels backward; without that, a pattern that
 * enters a way at its last point stitched the lane on backward and drew a
 * full-length teleport. Untrimmed (junction carve-back is Infrastructure-view
 * rendering detail this ambient-vehicle path doesn't need). Null if any way is
 * missing or has no resolvable lane (a lane-less profile) — callers fall back
 * to patternPath's centerline, matching buildFeatures' own per-way fallback.
 *
 * Named distinctly from geometry/vehicleLane.ts's patternLanePath — that one
 * resolves the lane a service's VEHICLE dot/shape rides (mode-catalog
 * preferredLaneKindIds); this one resolves the lane the SERVICE LINE itself
 * renders on (serviceLaneOnWay's pattern.lanes pins + defaultLaneFor). Same
 * problem, two independent call sites, not yet unified.
 */
export function serviceLanePath(
  pattern: Pattern,
  waysById: Map<string, Way>,
  modeId: string,
): LngLat[] | null {
  const segments = patternSegments(waysById, pattern);
  // A way the pattern references but that couldn't be resolved is dropped by
  // patternSegments; the contract here is all-or-nothing, so that's a null.
  if (segments.length !== patternLegs(pattern).length) return null;
  const lanePaths: LngLat[][] = [];
  for (const { way, forward, wayIndex } of segments) {
    const laneId = serviceLaneOnWay(pattern, wayIndex, waysById, modeId);
    const lane = laneId ? wayLaneGeometry(way).lanes.find((l) => l.laneId === laneId) : undefined;
    if (!lane || lane.path.length < 2) return null;
    lanePaths.push(forward ? lane.path : [...lane.path].reverse());
  }
  const path = stitchPaths(lanePaths);
  return path.length >= 2 ? path : null;
}

/** Quick bbox pre-check: does this way plausibly intersect the view? Padded
 *  by its own half-width so a wide road whose centerline sits just offscreen
 *  still renders. Cheap linear filter — fine for hand-drawn systems and a
 *  viewport's worth of OSM import; a grid index can slot in behind this
 *  signature if profiling ever demands it. */
export function wayIntersectsBounds(way: Way, bounds: [LngLat, LngLat], padDeg = 0.002): boolean {
  const [[west, south], [east, north]] = bounds;
  const minX = west - padDeg,
    maxX = east + padDeg,
    minY = south - padDeg,
    maxY = north + padDeg;
  const pts = way.points;
  for (let i = 0; i < pts.length; i++) {
    const [lng, lat] = pts[i];
    // A control point inside the padded box — or a SEGMENT that cuts across it
    // even though both its endpoints sit outside. Without the segment test, a
    // long road/track whose vertices are far apart culled its own lane detail
    // when you zoomed into its middle, even though it plainly crossed the view.
    if (lng >= minX && lng <= maxX && lat >= minY && lat <= maxY) return true;
    if (i > 0 && segmentIntersectsBox(pts[i - 1], pts[i], { minX, minY, maxX, maxY })) return true;
  }
  return false;
}

/** Liang–Barsky segment ∩ axis-aligned box — true when a→b crosses the box,
 *  including the case where both endpoints lie outside it. */
interface StreetBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function segmentIntersectsBox(a: LngLat, b: LngLat, bounds: StreetBounds): boolean {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  let t0 = 0,
    t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] - bounds.minX],
    [dx, bounds.maxX - a[0]],
    [-dy, a[1] - bounds.minY],
    [dy, bounds.maxY - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false; // parallel to this edge and outside its slab
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}
