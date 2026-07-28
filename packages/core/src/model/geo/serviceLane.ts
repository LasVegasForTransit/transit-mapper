// Which physical lane a service rides on a given way — the domain logic behind
// lane-accurate rendering in the Infrastructure view (a bus on the curb lane, a
// train on its track) versus the schematic centerline bundle of the Network
// view. Pure and data-oriented like the rest of geo/: no store, no style. A
// committed Pattern stores only ordered wayIds and NO travel direction
// (materializeRouteSpans discards it), so the traversal direction is DERIVED
// by servicePaths.ts's patternSegments and fed to profile.ts's defaultLaneFor.

import { defaultLaneFor } from '../profile';
import type { Pattern, Way } from '../system';
import { patternSegments } from './servicePaths';

/** The lane kinds a mode prefers, most-preferred first — a bus wants a
 *  dedicated bus lane then a drive lane; rail wants its track. Fed to
 *  defaultLaneFor's `preferKindIds`. No such field exists on the mode catalog,
 *  so the mapping lives here. */
export function preferredLaneKinds(modeId: string): readonly string[] {
  switch (modeId) {
    case 'bus':
    case 'brt':
      return ['bus', 'drive'];
    case 'subway':
    case 'commuterRail':
    case 'lightRail':
    case 'tram':
    case 'monorail':
      return ['track'];
    case 'gondola':
    case 'ferry':
      return ['channel'];
    default:
      return ['drive'];
  }
}

/**
 * Which direction `pattern.wayIds[wayIndex]` is traversed in — "forward"
 * (increasing point index) or "backward".
 *
 * A thin lookup over patternSegments, which owns the derivation for the whole
 * app. This used to derive direction itself from endpoint coincidence with the
 * neighbouring way, which disagreed with geometry/vehicleLane.ts's own
 * proximity-based derivation on the first way of a pattern — the two picked
 * opposite lanes for the same service. A way the pattern doesn't reach (a
 * missing or degenerate way) reports "forward", the same benign default as
 * before.
 */
export function patternWayDirection(
  pattern: Pattern,
  wayIndex: number,
  waysById: Map<string, Way>,
): 'forward' | 'backward' {
  const seg = patternSegments(waysById, pattern).find((s) => s.wayIndex === wayIndex);
  return seg && !seg.forward ? 'backward' : 'forward';
}

/**
 * The LaneSpec id a service of mode `modeId` rides on `pattern.wayIds[wayIndex]`:
 * an explicit `pattern.lanes` pin if set, else the default resolved from the
 * way's cross-section, the pattern's derived travel direction, and the mode's
 * preferred lane kinds. Null only for a lane-less profile.
 */
export function serviceLaneOnWay(
  pattern: Pattern,
  wayIndex: number,
  waysById: Map<string, Way>,
  modeId: string,
): string | null {
  const way = waysById.get(pattern.wayIds[wayIndex]);
  if (!way) return null;
  const pinned = pattern.lanes?.[way.id];
  if (pinned) return pinned;
  return defaultLaneFor(
    way.profile,
    patternWayDirection(pattern, wayIndex, waysById),
    preferredLaneKinds(modeId),
  );
}
