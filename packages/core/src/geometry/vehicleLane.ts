// The polyline a pattern's vehicles ride in Infrastructure view: real lanes,
// not the way's bare centerline, and a separate path for each of the two runs.
// Lives in geometry/, not model/geo/, because it needs wayLaneGeometry
// (geometry/streets.ts), which itself depends on model/ — a model/ file
// reaching back into geometry/ would be circular.
//
// All this supplies is one leg's geometry. Which legs, in what order, facing
// which way, and how the pieces join is servicePaths.ts's, shared with the
// centerline path — and WHICH LANE is serviceLaneOnWay's, shared with the line
// buildFeatures draws. This file used to answer all of that itself, and on the
// default four-lane road it put the trains one lane inboard of their own line.

import {
  legIsWhole,
  legRange,
  patternRunSegments,
  serviceLaneOnWay,
  slicePathByT,
  stitchPaths,
  wayById,
  type PatternSegment,
  type RunDirection,
} from '../model/geo';
import type { LngLat, Pattern, Way } from '../model/system';
import { wayLaneGeometry } from './streets';

/**
 * The path one run of `pattern` rides, with every leg resolved to its lane.
 *
 * The two runs are NOT the same line walked in opposite directions. Each way
 * is traversed the other way round on the return, which resolves to the lane
 * carrying that direction — the far side of the street. Drawing both runs on
 * the outbound lane is what had a line's trains meeting head-on and passing
 * through each other.
 *
 * A leg with no resolvable lane (a lane-less profile) falls back to that leg's
 * plain centerline, so a pattern never vanishes because one of its ways
 * happens to be bare, unprofiled infrastructure.
 */
export function patternLanePath(
  ways: Way[],
  pattern: Pattern,
  modeId: string,
  run: RunDirection = 'outbound',
): LngLat[] {
  const waysById = wayById(ways);
  return stitchPaths(
    patternRunSegments(waysById, pattern, run).map((segment) =>
      laneSegmentPath(waysById, pattern, modeId, segment),
    ),
  );
}

/** One segment's lane centerline, trimmed to the leg's extent and oriented
 *  into travel order — matching what `segment.path` already is for the way's
 *  own centerline. */
function laneSegmentPath(
  waysById: Map<string, Way>,
  pattern: Pattern,
  modeId: string,
  segment: PatternSegment,
): LngLat[] {
  const laneId = serviceLaneOnWay(pattern, segment.wayIndex, waysById, modeId, segment.forward);
  const lane = laneId
    ? wayLaneGeometry(segment.way).lanes.find((l) => l.laneId === laneId)
    : undefined;
  if (!lane || lane.path.length < 2) return segment.path;
  // A lane path is the way's FULL centerline offset sideways: the way's own
  // point order, and the way's whole extent. A leg covering part of a way has
  // to cut the lane back to the same stretch, or a line that stops mid-block
  // still runs its vehicles along the whole street.
  const [lo, hi] = legRange(segment.leg);
  const trimmed = legIsWhole(segment.leg) ? lane.path : slicePathByT(lane.path, lo, hi);
  if (trimmed.length < 2) return segment.path;
  return segment.forward ? trimmed : [...trimmed].reverse();
}
