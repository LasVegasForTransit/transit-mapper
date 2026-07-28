// Which physical lane a service rides on a given way — the domain logic behind
// lane-accurate rendering in the Infrastructure view (a bus on the curb lane, a
// train on its track) versus the schematic centerline bundle of the Network
// view. Pure and data-oriented like the rest of geo/: no store, no style. The
// direction a pattern travels a way is stored on its leg (see
// system/service.ts) and fed to profile.ts's defaultLaneFor.

import { mode } from '../catalog';
import { defaultLaneFor } from '../profile';
import type { Pattern, Way } from '../system';
import { legPinnedLane, legRunsWithPoints, patternLegs } from './servicePaths';

/** The lane kinds a mode prefers, most-preferred first — a bus wants a
 *  dedicated bus lane then a drive lane; rail wants its track. Fed to
 *  defaultLaneFor's `preferKindIds`. Read from the mode catalog rather than
 *  restated here, so a new mode is a catalog entry and nothing else. */
export function preferredLaneKinds(modeId: string): readonly string[] {
  return mode(modeId).preferredLaneKindIds ?? [];
}

/**
 * The LaneSpec id a service of mode `modeId` rides on `patternLegs(pattern)[wayIndex]`:
 * the leg's own pin if set, else the default resolved from the way's
 * cross-section, the direction of travel, and the mode's preferred lane
 * kinds. Null only for a lane-less profile.
 *
 * This is the ONLY answer to "which lane" in the app: the service line
 * buildFeatures draws and the vehicles geometry/vehicleLane.ts runs along it
 * both come from here. They used to resolve it separately — the line taking
 * the curb lane for its direction, the vehicles taking whichever lane sat
 * nearest the centerline — and diverged by exactly one lane width on any road
 * with more than one lane each way. The trains visibly did not run on their
 * own line.
 *
 * `forward` overrides the leg's own direction, for the RETURN run: the same
 * leg travelled the other way resolves to the lane on the other side of the
 * street. A leg's lane pin is not per-direction, so a pinned leg puts both
 * runs in the one lane the planner named. That is single-track running, and it
 * is what they asked for.
 */
export function serviceLaneOnWay(
  pattern: Pattern,
  wayIndex: number,
  waysById: Map<string, Way>,
  modeId: string,
  forward?: boolean,
): string | null {
  const leg = patternLegs(pattern)[wayIndex];
  if (!leg) return null;
  const way = waysById.get(leg.wayId);
  if (!way) return null;
  const pinned = legPinnedLane(leg);
  if (pinned) return pinned;
  return defaultLaneFor(
    way.profile,
    (forward ?? legRunsWithPoints(leg)) ? 'forward' : 'backward',
    preferredLaneKinds(modeId),
  );
}
