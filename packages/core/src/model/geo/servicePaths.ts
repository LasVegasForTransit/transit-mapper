import type { LngLat, Pattern, Service, Way } from '../system';
import { haversineMeters } from './spherical';
import { resolveWayPath, wayById } from './wayPath';

/** Every way a service touches across ALL its patterns, deduplicated — the
 *  right unit for "does this way carry this service" (rendering bundle/
 *  offset counts, interchange detection, …), where a service having two
 *  branches that share a trunk way must still count as ONE service on that
 *  way, not two. Use a pattern's own `wayIds` directly when you need one
 *  branch's ordered path specifically. */
export function serviceWayIds(service: Service): string[] {
  return [...new Set(service.patterns.flatMap((p) => p.wayIds))];
}

/** One way of a pattern, resolved into the pattern's own direction of travel.
 *  `path` runs from where the pattern enters the way to where it leaves it,
 *  so consecutive segments concatenate directly. */
export interface PatternSegment {
  /** Position in `pattern.wayIds` — what serviceLaneOnWay's `wayIndex`
   *  expects. Not the index into the returned array, which skips missing and
   *  degenerate ways. */
  wayIndex: number;
  way: Way;
  /** Traversed with increasing point index. */
  forward: boolean;
  /** The way's resolved path, oriented into travel order. */
  path: LngLat[];
}

interface CachedSegments {
  segments: PatternSegment[];
  forWaysById: Map<string, Way>;
}

// Keyed by the Pattern's own reference with a ways-map guard, the same
// discipline as wayPath.ts's own caches: a Pattern object survives edits to
// the ways it references, so the reference alone is not enough to trust a
// hit. buildFeatures resolves direction per way per rider on every rebuild —
// once per animation frame during a drag — so re-deriving the whole sequence
// at each lookup would make that quadratic in a pattern's length.
const segmentsCache = new WeakMap<Pattern, CachedSegments>();

interface ResolvedWay {
  wayIndex: number;
  way: Way;
  raw: LngLat[];
}

/**
 * A pattern's ways in ride order, each oriented the way the pattern actually
 * travels it.
 *
 * Direction is not stored on a Pattern — it holds only an ordered list of way
 * ids — so it is derived by continuity, and this is the ONE place that derives
 * it. Two partial derivations used to sit side by side (geometry/vehicleLane.ts
 * oriented by endpoint proximity but always left the FIRST way in its stored
 * order; geo/serviceLane.ts tested endpoint coincidence but fell back to
 * "forward" on any tie), and two further call sites concatenated ways with no
 * orientation at all. That last group was a real defect rather than a
 * simplification: routeBetween emits spans in both directions, so a
 * backward-traversed way produced a full-length teleport in the rendered line.
 *
 * The first way is oriented by which of its own endpoints sits nearer the
 * SECOND way — that endpoint is where the pattern exits, so it enters at the
 * other one. Every way after that is oriented toward whichever of its
 * endpoints is nearer the previous way's exit point. A single-way pattern has
 * no continuity to read and keeps its stored order.
 */
export function patternSegments(waysById: Map<string, Way>, pattern: Pattern): PatternSegment[] {
  const cached = segmentsCache.get(pattern);
  if (cached && cached.forWaysById === waysById) return cached.segments;

  const resolved: ResolvedWay[] = [];
  pattern.wayIds.forEach((wayId, wayIndex) => {
    const way = waysById.get(wayId);
    if (!way) return;
    const raw = resolveWayPath(way);
    if (raw.length < 2) return;
    resolved.push({ wayIndex, way, raw });
  });

  const segments: PatternSegment[] = [];
  let prevExit: LngLat | null = null;
  resolved.forEach((entry, i) => {
    const start = entry.raw[0];
    const end = entry.raw[entry.raw.length - 1];
    let forward: boolean;
    if (prevExit !== null) {
      forward = haversineMeters(prevExit, start) <= haversineMeters(prevExit, end);
    } else {
      const next = resolved[i + 1];
      if (next) {
        // Exit at whichever of this way's own ends the next way reaches first.
        const nextEnds = [next.raw[0], next.raw[next.raw.length - 1]];
        const viaEnd = Math.min(...nextEnds.map((p) => haversineMeters(end, p)));
        const viaStart = Math.min(...nextEnds.map((p) => haversineMeters(start, p)));
        forward = viaEnd <= viaStart;
      } else {
        forward = true;
      }
    }
    segments.push({
      wayIndex: entry.wayIndex,
      way: entry.way,
      forward,
      path: forward ? entry.raw : [...entry.raw].reverse(),
    });
    prevExit = forward ? end : start;
  });

  segmentsCache.set(pattern, { segments, forWaysById: waysById });
  return segments;
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
 *  traces — its ways, in ride order and in the direction it travels each of
 *  them, stitched into one polyline. */
export function patternPath(ways: Way[], pattern: Pattern): LngLat[] {
  return stitchPaths(patternSegments(wayById(ways), pattern).map((s) => s.path));
}
