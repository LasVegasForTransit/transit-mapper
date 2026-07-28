// Which physical lane a service rides on a given way — the domain logic behind
// lane-accurate rendering in the Infrastructure view (a bus on the curb lane, a
// train on its track) versus the schematic centerline bundle of the Network
// view. Pure and data-oriented like the rest of geo/: no store, no style. The
// direction a pattern travels a way is stored on its leg (see
// system/service.ts) and fed to profile.ts's defaultLaneFor.

import { mode } from '../catalog';
import { defaultLaneFor } from '../profile';
import type { Pattern, Way } from '../system';

/** The lane kinds a mode prefers, most-preferred first — a bus wants a
 *  dedicated bus lane then a drive lane; rail wants its track. Fed to
 *  defaultLaneFor's `preferKindIds`. Read from the mode catalog rather than
 *  restated here, so a new mode is a catalog entry and nothing else. */
export function preferredLaneKinds(modeId: string): readonly string[] {
  return mode(modeId).preferredLaneKindIds ?? [];
}

/**
 * The LaneSpec id a service of mode `modeId` rides on `pattern.legs[wayIndex]`:
 * the leg's own pin if set, else the default resolved from the way's
 * cross-section, the leg's travel direction, and the mode's preferred lane
 * kinds. Null only for a lane-less profile.
 */
export function serviceLaneOnWay(
  pattern: Pattern,
  wayIndex: number,
  waysById: Map<string, Way>,
  modeId: string,
): string | null {
  const leg = pattern.legs[wayIndex];
  if (!leg) return null;
  const way = waysById.get(leg.wayId);
  if (!way) return null;
  if (leg.laneId) return leg.laneId;
  return defaultLaneFor(
    way.profile,
    leg.forward ? 'forward' : 'backward',
    preferredLaneKinds(modeId),
  );
}
