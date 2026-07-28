// The pure router (model/routeGraph.ts) returns RouteSpans — stretches of
// existing ways, possibly with fractional mid-way endpoints. Materializing a
// route turns those into the legs a Pattern rides. A fractional endpoint is
// the leg's extent; nothing is inserted into a way and nothing is split, so
// routing a line over existing infrastructure leaves that infrastructure
// exactly as it was.
//
// This lived in the editor store until through-routing two lines needed the
// same conversion to bridge the gap between their termini. It was already
// pure, so moving it here cost nothing and stopped a second copy existing.

import { nearestOnPath, resolveWayPath, wholeLeg, stretchLeg } from './geo';
import type { RouteSpan } from './routeGraph';
import type { PatternLeg, TransitSystem } from './system';

// A span shorter than this covers no ground worth drawing — two anchors that
// landed on effectively the same spot. Rejected rather than stored as a
// zero-length leg nothing can render.
const DEGENERATE_SPAN_T = 1e-9;

/**
 * Turn a routed path into the legs a pattern runs over.
 *
 * This used to make the route fit the model rather than the other way round.
 * A pattern could only name whole ways, so a span that began or ended mid-way
 * had a control point spliced in and the way cut around it — and that cut
 * changed the way for everyone: it extended every other rider's pattern,
 * reanchored every station on it, reindexed every node ref, and left a
 * fragment that never went away. Drawing a line that terminated in the middle
 * of a boulevard permanently divided the boulevard.
 *
 * A span's endpoints are now just the leg's extent, so nothing is inserted,
 * nothing is split, and the system comes back untouched — hence a pure
 * function returning legs rather than a new system.
 *
 * Interior span boundaries need no extent at all: routeBetween's graph only
 * has vertices at way endpoints and junction-referenced points, so consecutive
 * spans already meet at a genuinely shared coordinate. Only the route's own
 * two ends can fall mid-way, and those are exactly the splits worth not
 * making.
 */
export function materializeRouteSpans(
  system: TransitSystem,
  spans: RouteSpan[],
): PatternLeg[] | null {
  const legs: PatternLeg[] = [];
  for (const s of spans) {
    const way = system.ways.find((w) => w.id === s.wayId);
    if (!way) return null;
    const path = resolveWayPath(way);
    if (path.length < 2) return null;

    // A span reports its ends either as a raw control point or, where the
    // route started or finished mid-way, as a coordinate. Both become a
    // position along the resolved path, which is the ruler a leg's extent is
    // measured against — and the same projection station anchoring uses, so a
    // curved way's fillets are handled identically in both places.
    const startCoord = s.fromCoord ?? way.points[s.fromPoint];
    const endCoord = s.toCoord ?? way.points[s.toPoint];
    if (!startCoord || !endCoord) return null;
    const from = nearestOnPath(path, startCoord);
    const to = nearestOnPath(path, endCoord);
    if (!from || !to) return null;
    if (Math.abs(from.t - to.t) < DEGENERATE_SPAN_T) return null;

    const forward = from.t <= to.t;
    const lo = Math.min(from.t, to.t);
    const hi = Math.max(from.t, to.t);
    const whole = lo <= 0 && hi >= 1;
    const leg = wholeLeg(s.wayId, forward ? 'withPoints' : 'againstPoints');
    legs.push(whole ? leg : stretchLeg(leg, lo, hi));
  }
  return legs.length > 0 ? legs : null;
}
