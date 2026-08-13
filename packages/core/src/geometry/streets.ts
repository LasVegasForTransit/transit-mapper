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
  pointAtDistance,
  patternSegments,
  resolveWayPath,
  resolveWayPathAtError,
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

/** A physical strip of the cross-section. The two boundary arrays are shared
 * with the neighbouring strip, so the renderer never invents a hairline gap
 * between adjacent lanes by offsetting the same edge twice. `LanePath` stays
 * separate because vehicles and route lines travel along a centerline; this
 * describes the asphalt or guideway they occupy. */
export interface LaneSurface {
  laneId: string;
  kindId: string;
  widthM: number;
  leftBoundary: LngLat[];
  rightBoundary: LngLat[];
  /** Closed exterior ring, ordered from the left boundary to the right. */
  ring: LngLat[];
}

/** The standard-gauge separation between the two running rails. Track
 * profiles describe their occupied corridor width; this is the physical
 * detail inside that corridor. */
export const STANDARD_RAIL_GAUGE_M = 1.435;
export const STANDARD_RAIL_TIE_SPACING_M = 0.65;

export interface RailTrackGeometry {
  rails: [LngLat[], LngLat[]];
  ties: LngLat[][];
}

/** Derive the visible rail hardware inside a track's centerline. The caller
 * can increase `tieSpacingM` when the final display cannot resolve sleepers;
 * it never changes the rail gauge. */
export function railTrackGeometry(
  track: LanePath,
  tieSpacingM = STANDARD_RAIL_TIE_SPACING_M,
): RailTrackGeometry {
  if (track.path.length < 2 || tieSpacingM <= 0) return { rails: [[], []], ties: [] };
  const rails: [LngLat[], LngLat[]] = [
    offsetPolyline(track.path, -STANDARD_RAIL_GAUGE_M / 2),
    offsetPolyline(track.path, STANDARD_RAIL_GAUGE_M / 2),
  ];
  const lengths = rails.map(cumulativeLengths) as [Float64Array, Float64Array];
  const lengthM = Math.min(lengths[0][lengths[0].length - 1], lengths[1][lengths[1].length - 1]);
  const ties: LngLat[][] = [];
  for (let distanceM = tieSpacingM / 2; distanceM < lengthM; distanceM += tieSpacingM) {
    ties.push([
      pointAtDistance(rails[0], lengths[0], distanceM),
      pointAtDistance(rails[1], lengths[1], distanceM),
    ]);
  }
  return { rails, ties };
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
  laneSurfaces: LaneSurface[];
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

function trimmedWayCenterline(
  way: Way,
  trimStartM: number,
  trimEndM: number,
  curveErrorM: number | undefined,
): LngLat[] {
  const path =
    curveErrorM === undefined ? resolveWayPath(way) : resolveWayPathAtError(way, curveErrorM);
  return trimPath(path, trimStartM, trimEndM);
}

/** Resolve the cross-section from an already-trimmed centerline. This is kept
 * separate from the cache wrapper so geometry and cache lifecycles remain
 * understandable on their own. */
function deriveLaneCrossSection(center: LngLat[], way: Way): Omit<WayLaneGeometry, 'wayId'> {
  const lanes: LanePath[] = [];
  const laneSurfaces: LaneSurface[] = [];
  const dividers: DividerPath[] = [];
  const arrows: LanePath[] = [];
  const totalWidthM = profileWidthM(way.profile);
  if (center.length < 2 || way.profile.lanes.length === 0) {
    return { totalWidthM, lanes, laneSurfaces, dividers, arrows };
  }

  // Resolve each physical boundary once. Neighbours retain the same array,
  // which prevents a gap caused by separately offsetting their shared edge.
  const boundaries: LngLat[][] = [offsetPolyline(center, -totalWidthM / 2)];
  let cumulativeWidthM = 0;
  for (const lane of way.profile.lanes) {
    const leftBoundary = boundaries[boundaries.length - 1];
    const offsetM = cumulativeWidthM + lane.widthM / 2 - totalWidthM / 2;
    cumulativeWidthM += lane.widthM;
    const rightBoundary = offsetPolyline(center, cumulativeWidthM - totalWidthM / 2);
    boundaries.push(rightBoundary);
    const path = offsetPolyline(center, offsetM);
    const lanePath: LanePath = {
      laneId: lane.id,
      kindId: lane.kindId,
      direction: lane.direction,
      widthM: lane.widthM,
      offsetM,
      path,
    };
    lanes.push(lanePath);
    laneSurfaces.push({
      laneId: lane.id,
      kindId: lane.kindId,
      widthM: lane.widthM,
      leftBoundary,
      rightBoundary,
      ring: [...leftBoundary, ...rightBoundary.slice().reverse(), leftBoundary[0]],
    });
  }

  for (let index = 1; index < way.profile.lanes.length; index++) {
    const before = way.profile.lanes[index - 1];
    const after = way.profile.lanes[index];
    const beforeDirectional = laneKind(before.kindId).directional;
    const afterDirectional = laneKind(after.kindId).directional;
    if (beforeDirectional !== afterDirectional) {
      dividers.push({
        kind: 'edgeLine',
        beforeLaneId: before.id,
        afterLaneId: after.id,
        path: boundaries[index],
      });
    } else if (beforeDirectional) {
      const opposing =
        (before.direction === 'forward' && after.direction === 'backward') ||
        (before.direction === 'backward' && after.direction === 'forward');
      dividers.push({
        kind: opposing ? 'centerLine' : 'laneLine',
        beforeLaneId: before.id,
        afterLaneId: after.id,
        path: boundaries[index],
      });
    }
  }

  for (const lane of lanes) {
    if (!laneKind(lane.kindId).directional) continue;
    if (lane.direction === 'forward') arrows.push(lane);
    else if (lane.direction === 'backward')
      arrows.push({ ...lane, path: [...lane.path].reverse() });
  }
  return { totalWidthM, lanes, laneSurfaces, dividers, arrows };
}

/** Same geometry contract with truthful cache attribution for the renderer's
 * performance counters. Callers that do not instrument projection keep using
 * `wayLaneGeometry` below. */
export function resolveWayLaneGeometry(
  way: Way,
  trimStartM = 0,
  trimEndM = 0,
  curveErrorM?: number,
): ResolvedWayLaneGeometry {
  let byTrim = cache.get(way);
  if (!byTrim) {
    byTrim = new Map();
    cache.set(way, byTrim);
  }
  const key = `${trimStartM.toFixed(2)}:${trimEndM.toFixed(2)}:${curveErrorM?.toPrecision(6) ?? 'model'}`;
  const cached = byTrim.get(key);
  if (cached) return { geometry: cached, cacheHit: true };
  while (byTrim.size >= MAX_TRIMS_PER_WAY) {
    const oldest = byTrim.keys().next();
    if (oldest.done) break;
    byTrim.delete(oldest.value);
  }

  const center = trimmedWayCenterline(way, trimStartM, trimEndM, curveErrorM);
  const result: WayLaneGeometry = { wayId: way.id, ...deriveLaneCrossSection(center, way) };
  byTrim.set(key, result);
  return { geometry: result, cacheHit: false };
}

export function wayLaneGeometry(
  way: Way,
  trimStartM = 0,
  trimEndM = 0,
  curveErrorM?: number,
): WayLaneGeometry {
  return resolveWayLaneGeometry(way, trimStartM, trimEndM, curveErrorM).geometry;
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
