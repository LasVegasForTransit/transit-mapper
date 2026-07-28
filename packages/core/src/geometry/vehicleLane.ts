// Vehicle-in-Infrastructure-view geometry: which direction a pattern
// travels each of its ways, which real physical lane it rides, and the
// lane-aware polyline that results — the Infrastructure-view analog of
// model/geo/servicePaths.ts's patternPath, which only ever produces the
// way's raw centerline. Lives in geometry/, not model/geo/, because it
// needs wayLaneGeometry (geometry/streets.ts), which itself depends on
// model/ — a model/ file reaching back into geometry/ would be circular.

import { patternSegments, stitchPaths, wayById } from '../model/geo';
import { mode } from '../model/catalog';
import type { LaneDirection, LngLat, Pattern, Way } from '../model/system';
import { wayLaneGeometry, type LanePath } from './streets';

/** One way in a pattern's sequence, with which direction (relative to the
 *  way's own stored point order) the pattern travels it. Nothing in the data
 *  model records this — `Pattern.wayIds` is just an ordered list of ids — so
 *  it is derived by continuity in model/geo/servicePaths.ts, which owns that
 *  derivation for the whole app. */
export interface WayTraversal {
  way: Way;
  forward: boolean;
}

export function patternWayTraversals(ways: Way[], pattern: Pattern): WayTraversal[] {
  return patternSegments(wayById(ways), pattern).map(({ way, forward }) => ({ way, forward }));
}

/** A lane's path, oriented so index 0 → last matches the pattern's actual
 *  direction of travel through this way (lane.path itself always follows
 *  the way's own stored point order, same convention wayLaneGeometry's
 *  `arrows` field already uses for backward-direction lanes). */
function orientedLanePath(lane: LanePath, forward: boolean): LngLat[] {
  return forward ? lane.path : [...lane.path].reverse();
}

/**
 * Which of a way's real lanes a mode's vehicle rides, given the direction
 * the pattern travels this way: filter to lanes going that direction (or
 * bidirectional), prefer a lane kind the mode lists in
 * `preferredLaneKindIds` (checked in order, first kind with any match
 * wins), then break remaining ties by whichever lane sits closest to the
 * way's centerline. Returns null when the way has no lanes at all (no
 * profile, or nothing going this direction) — callers fall back to the
 * way's raw centerline.
 */
export function selectVehicleLane(way: Way, forward: boolean, modeId: string): LanePath | null {
  const geometry = wayLaneGeometry(way);
  const direction: LaneDirection = forward ? 'forward' : 'backward';
  const candidates = geometry.lanes.filter(
    (l) => l.direction === direction || l.direction === 'both',
  );
  if (candidates.length === 0) return null;

  const preferredKindIds = mode(modeId).preferredLaneKindIds ?? [];
  let pool = candidates;
  for (const kindId of preferredKindIds) {
    const matches = candidates.filter((l) => l.kindId === kindId);
    if (matches.length > 0) {
      pool = matches;
      break;
    }
  }
  return pool.reduce((best, l) => (Math.abs(l.offsetM) < Math.abs(best.offsetM) ? l : best));
}

/**
 * The Infrastructure-view analog of servicePaths.ts's patternPath: the
 * concatenated polyline a pattern actually rides once every way is
 * resolved to ITS SELECTED LANE (oriented for direction of travel)
 * instead of its bare centerline. A way with no matching lane (no
 * profile, or nothing going this direction) falls back to that way's
 * plain oriented centerline, so a pattern never just vanishes because one
 * of its ways happens to be bare/unprofiled infrastructure.
 */
export function patternLanePath(ways: Way[], pattern: Pattern, modeId: string): LngLat[] {
  return stitchPaths(
    patternSegments(wayById(ways), pattern).map(({ way, forward, path }) => {
      const lane = selectVehicleLane(way, forward, modeId);
      // `path` is already oriented into travel order; a lane path is not,
      // since wayLaneGeometry always follows the way's own point order.
      return lane ? orientedLanePath(lane, forward) : path;
    }),
  );
}
