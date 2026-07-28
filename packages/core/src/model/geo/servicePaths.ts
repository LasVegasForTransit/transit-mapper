import type { LngLat, Pattern, PatternLeg, Service, Way } from '../system';
import { slicePathByT } from './measurement';
import { haversineMeters } from './spherical';
import { resolveWayPath, wayById } from './wayPath';

/** The ways a pattern runs over, in ride order. Legs carry more than an id
 *  now, and most callers only want the ids. */
export function patternWayIds(pattern: Pattern): string[] {
  return pattern.legs.map((l) => l.wayId);
}

/** Every way a service touches across ALL its patterns, deduplicated — the
 *  right unit for "does this way carry this service" (rendering bundle/
 *  offset counts, interchange detection, …), where a service having two
 *  branches that share a trunk way must still count as ONE service on that
 *  way, not two. Use a pattern's own legs directly when you need one branch's
 *  ordered path specifically.
 *
 *  Deliberately coarse: a service that covers 5% of a way still reports that
 *  way. That is the safe direction for reserving a render slot, and the wrong
 *  one for "does this line actually reach this point" — use
 *  patternCoversWayAt for that. */
export function serviceWayIds(service: Service): string[] {
  return [...new Set(service.patterns.flatMap((p) => p.legs.map((l) => l.wayId)))];
}

/** The stretch of its way a leg covers, as an ordered [lo, hi] pair in the
 *  WAY's own parameterization (not travel order). */
export function legRange(leg: PatternLeg): [number, number] {
  const a = leg.fromT ?? 0;
  const b = leg.toT ?? 1;
  return a <= b ? [a, b] : [b, a];
}

/** Whether a leg covers the whole of its way — the common case, and the one
 *  where slicing can be skipped entirely. */
export function legIsWhole(leg: PatternLeg): boolean {
  const [lo, hi] = legRange(leg);
  return lo <= 0 && hi >= 1;
}

/** Does this pattern actually reach position `t` on `wayId`? The extent-aware
 *  counterpart to a bare `wayIds.includes(...)` test — a station anchored to a
 *  way a line only partly covers is not necessarily a stop on that line. */
export function patternCoversWayAt(pattern: Pattern, wayId: string, t: number): boolean {
  return pattern.legs.some((leg) => {
    if (leg.wayId !== wayId) return false;
    const [lo, hi] = legRange(leg);
    return t >= lo && t <= hi;
  });
}

/** One way of a pattern, resolved into the pattern's own direction of travel.
 *  `path` runs from where the pattern enters the way to where it leaves it,
 *  trimmed to the leg's extent, so consecutive segments concatenate directly. */
export interface PatternSegment {
  /** Position in `pattern.legs` — what serviceLaneOnWay's `wayIndex`
   *  expects. Not the index into the returned array, which skips missing and
   *  degenerate ways. */
  wayIndex: number;
  leg: PatternLeg;
  way: Way;
  /** Traversed with increasing point index. */
  forward: boolean;
  /** The way's resolved path, trimmed to the leg's extent and oriented into
   *  travel order. */
  path: LngLat[];
}

interface CachedSegments {
  segments: PatternSegment[];
  forWaysById: Map<string, Way>;
}

// Keyed by the Pattern's own reference with a ways-map guard, the same
// discipline as wayPath.ts's own caches: a Pattern object survives edits to
// the ways it references, so the reference alone is not enough to trust a
// hit. buildFeatures resolves every rider's geometry on every rebuild — once
// per animation frame during a drag — and slicing is no longer free now that
// a leg can cover part of a way.
const segmentsCache = new WeakMap<Pattern, CachedSegments>();

/**
 * A pattern's ways in ride order, each trimmed to its leg's extent and
 * oriented the way the pattern travels it.
 *
 * Direction comes from the leg, not from geometry — see deriveLegDirections
 * for where a caller that has only geometry gets one.
 */
export function patternSegments(waysById: Map<string, Way>, pattern: Pattern): PatternSegment[] {
  const cached = segmentsCache.get(pattern);
  if (cached && cached.forWaysById === waysById) return cached.segments;

  const segments: PatternSegment[] = [];
  pattern.legs.forEach((leg, wayIndex) => {
    const way = waysById.get(leg.wayId);
    if (!way) return;
    const raw = resolveWayPath(way);
    if (raw.length < 2) return;
    const [lo, hi] = legRange(leg);
    const trimmed = legIsWhole(leg) ? raw : slicePathByT(raw, lo, hi);
    if (trimmed.length < 2) return;
    segments.push({
      wayIndex,
      leg,
      way,
      forward: leg.forward,
      path: leg.forward ? trimmed : [...trimmed].reverse(),
    });
  });

  segmentsCache.set(pattern, { segments, forWaysById: waysById });
  return segments;
}

/**
 * Which direction each of an ordered list of ways is travelled, derived by
 * continuity — for callers that build a path from geometry and have no
 * direction to store yet (the v9→v10 migration, and any route materialization
 * that loses it).
 *
 * The first way is oriented by which of its own endpoints sits nearer the
 * SECOND way: that endpoint is where the path exits, so it enters at the
 * other one. Every way after that is oriented toward whichever of its
 * endpoints is nearer the previous way's exit point. A single way has no
 * continuity to read and keeps its stored order.
 *
 * Two partial versions of this used to sit side by side and disagree on the
 * first way of a pattern, which meant two parts of the app drew the same
 * service on opposite lanes.
 */
export function deriveLegDirections(waysById: Map<string, Way>, wayIds: string[]): boolean[] {
  const paths = wayIds.map((id) => {
    const way = waysById.get(id);
    const raw = way ? resolveWayPath(way) : [];
    return raw.length >= 2 ? raw : null;
  });
  const out: boolean[] = [];
  let prevExit: LngLat | null = null;
  paths.forEach((raw, i) => {
    if (!raw) {
      out.push(true);
      return;
    }
    const start = raw[0];
    const end = raw[raw.length - 1];
    let forward: boolean;
    if (prevExit !== null) {
      forward = haversineMeters(prevExit, start) <= haversineMeters(prevExit, end);
    } else {
      const next = paths.slice(i + 1).find((p) => p !== null);
      if (next) {
        // Exit at whichever of this way's own ends the next way reaches first.
        const nextEnds = [next[0], next[next.length - 1]];
        const viaEnd = Math.min(...nextEnds.map((p) => haversineMeters(end, p)));
        const viaStart = Math.min(...nextEnds.map((p) => haversineMeters(start, p)));
        forward = viaEnd <= viaStart;
      } else {
        forward = true;
      }
    }
    out.push(forward);
    prevExit = forward ? end : start;
  });
  return out;
}

/** Build full-extent legs over an ordered way list, deriving each way's
 *  direction from geometry. The shape almost every caller that creates a
 *  pattern wants. */
export function wholeLegs(
  waysById: Map<string, Way>,
  wayIds: string[],
  lanes?: Record<string, string>,
): PatternLeg[] {
  const dirs = deriveLegDirections(waysById, wayIds);
  return wayIds.map((wayId, i) => {
    const laneId = lanes?.[wayId];
    return { wayId, forward: dirs[i], ...(laneId ? { laneId } : {}) };
  });
}

/** Stitch already-oriented segment paths into one polyline, dropping each
 *  segment's first point as the junction coordinate the previous one already
 *  contributed. Takes bare polylines so callers that substitute a lane
 *  centerline for the way's own path (see geometry/) can reuse it. */
export function stitchPaths(paths: LngLat[][]): LngLat[] {
  const out: LngLat[] = [];
  for (const seg of paths) {
    if (seg.length < 2) continue;
    out.push(...(out.length ? seg.slice(1) : seg));
  }
  return out;
}

/** The concatenated resolved path a single pattern (branch) actually
 *  traces — its ways, in ride order, in the direction it travels each of
 *  them, trimmed to the stretch of each it uses, stitched into one
 *  polyline. */
export function patternPath(ways: Way[], pattern: Pattern): LngLat[] {
  return stitchPaths(patternSegments(wayById(ways), pattern).map((s) => s.path));
}
