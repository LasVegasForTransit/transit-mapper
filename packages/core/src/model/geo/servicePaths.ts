import type { LegDirection, LngLat, Pattern, PatternLeg, Service, Way } from '../system';
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
  if (leg.extent.kind === 'whole') return [0, 1];
  const { fromT, toT } = leg.extent;
  return fromT <= toT ? [fromT, toT] : [toT, fromT];
}

/** Whether a leg covers the whole of its way — the common case, and the one
 *  where slicing can be skipped entirely. A `stretch` that happens to span
 *  [0, 1] counts, so a leg widened back to full behaves like one that never
 *  was trimmed even before withRange normalizes it. */
export function legIsWhole(leg: PatternLeg): boolean {
  if (leg.extent.kind === 'whole') return true;
  const [lo, hi] = legRange(leg);
  return lo <= 0 && hi >= 1;
}

/** Whether a leg runs its way with the way's own point order. The boolean the
 *  path-orientation code wants, named once rather than spelled out at every
 *  comparison. */
export function legRunsWithPoints(leg: PatternLeg): boolean {
  return leg.direction === 'withPoints';
}

/** The lane a leg is pinned to, or null when it resolves at render time. */
export function legPinnedLane(leg: PatternLeg): string | null {
  return leg.lane.kind === 'pinned' ? leg.lane.laneId : null;
}

/** A leg running the whole of a way in the way's own point order, lane
 *  unresolved — what almost every construction site wants, and short enough
 *  that nobody is tempted to write the record out by hand and get a field
 *  wrong. */
export function wholeLeg(wayId: string, direction: LegDirection = 'withPoints'): PatternLeg {
  return { wayId, direction, extent: { kind: 'whole' }, lane: { kind: 'auto' } };
}

/** The same leg cut back to `[fromT, toT]` of its way. `fromT`/`toT` are in
 *  the WAY's own parameterization, not travel order, so this reads the same
 *  whichever way round the leg runs. */
export function stretchLeg(leg: PatternLeg, fromT: number, toT: number): PatternLeg {
  return { ...leg, extent: { kind: 'stretch', fromT, toT } };
}

/** Does this pattern actually reach position `t` on `wayId`? The extent-aware
 *  counterpart to a bare way-id membership test — a station anchored to a way a
 *  line only partly covers is not necessarily a stop on that line. */
export function patternCoversWayAt(pattern: Pattern, wayId: string, t: number): boolean {
  return pattern.legs.some((leg) => {
    if (leg.wayId !== wayId) return false;
    const [lo, hi] = legRange(leg);
    return t >= lo && t <= hi;
  });
}

/** Whether this service reaches position `t` on `wayId`, across all its
 *  branches. */
export function serviceCoversWayAt(service: Service, wayId: string, t: number): boolean {
  return service.patterns.some((p) => patternCoversWayAt(p, wayId, t));
}

/** Whether any of a service's legs covers less than a whole way. Almost always
 *  false, which is worth knowing: it lets the extent-aware paths in rendering
 *  skip their extra work entirely for a system nobody has trimmed. */
export function serviceHasPartialLeg(service: Service): boolean {
  return service.patterns.some((p) => p.legs.some((l) => !legIsWhole(l)));
}

/**
 * The stretches of `wayId` a service appears on, as merged `[lo, hi]` ranges in
 * the way's own parameterization — what rendering needs to draw the line where
 * it actually runs.
 *
 * Merged, because two branches of one service overlapping on a shared trunk
 * are one line on the ground, not two stacked on top of each other. A service
 * that covers the way end to end yields the single range `[0, 1]`.
 */
export function serviceRangesOnWay(service: Service, wayId: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const pattern of service.patterns) {
    for (const leg of pattern.legs) {
      if (leg.wayId === wayId) ranges.push(legRange(leg));
    }
  }
  if (ranges.length <= 1) return ranges;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [ranges[0]];
  for (const [lo, hi] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (lo <= last[1]) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return merged;
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
    const forward = legRunsWithPoints(leg);
    segments.push({
      wayIndex,
      leg,
      way,
      forward,
      path: forward ? trimmed : [...trimmed].reverse(),
    });
  });

  segmentsCache.set(pattern, { segments, forWaysById: waysById });
  return segments;
}

/** Which of a pattern's two runs is being resolved. */
export type RunDirection = 'outbound' | 'inbound';

/**
 * A pattern's segments for one run.
 *
 * The return run is the outbound list MIRRORED — reversed order, each segment
 * reversed and its direction flipped — rather than resolved a second time, so
 * the two runs cannot disagree about a way. It is a genuinely different piece
 * of ground once lanes are involved: the far curb of a two-way street.
 */
export function patternRunSegments(
  waysById: Map<string, Way>,
  pattern: Pattern,
  run: RunDirection = 'outbound',
): PatternSegment[] {
  const outbound = patternSegments(waysById, pattern);
  if (run === 'outbound') return outbound;
  return outbound
    .map((s) => ({ ...s, forward: !s.forward, path: [...s.path].reverse() }))
    .reverse();
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
    return {
      ...wholeLeg(wayId, dirs[i] ? 'withPoints' : 'againstPoints'),
      ...(laneId ? { lane: { kind: 'pinned' as const, laneId } } : {}),
    };
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
