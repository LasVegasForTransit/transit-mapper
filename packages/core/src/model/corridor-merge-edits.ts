import { conflatePatternOntoExisting } from './corridor-edits';
import {
  CONFLATION_TOLERANCE_M,
  densifyForMatching,
  nearestOnPath,
  patternLegs,
  resolveWayPath,
  wayLengthMeters,
} from './geo';
import type { TransitSystem, Way } from './system';

const MAX_EXPLICIT_TOLERANCE_M = 60;

export interface MergeCorridorResult {
  system: TransitSystem;
  absorbed: number;
}

function maxSeparationM(candidate: Way, keeper: Way): number | null {
  const keeperPath = resolveWayPath(keeper);
  const candidatePath = densifyForMatching(resolveWayPath(candidate), CONFLATION_TOLERANCE_M);
  if (keeperPath.length < 2 || candidatePath.length < 2) return null;
  let worst = 0;
  for (const point of candidatePath) {
    const nearest = nearestOnPath(keeperPath, point);
    if (!nearest || nearest.t <= 0 || nearest.t >= 1) continue;
    worst = Math.max(worst, nearest.distMeters);
  }
  return worst;
}

function conflateWay(
  system: TransitSystem,
  way: Way,
  firstKeeper: Way,
  keepers: Set<string>,
): TransitSystem {
  const separationM = maxSeparationM(way, firstKeeper);
  const toleranceM =
    separationM === null ? undefined : Math.min(separationM * 1.5 + 5, MAX_EXPLICIT_TOLERANCE_M);
  let next = system;
  for (const service of system.services) {
    if (!patternLegs(service.path).some((leg) => leg.wayId === way.id)) continue;
    next = conflatePatternOntoExisting(next, service.id, service.path.id, keepers, toleranceM);
  }
  return next;
}

/** Explicitly conflates selected ways longest-first into shared corridors. */
export function mergeWaysIntoCorridor(
  system: TransitSystem,
  wayIds: string[],
): MergeCorridorResult {
  const ordered = wayIds
    .map((wayId) => system.ways.find((way) => way.id === wayId))
    .filter((way): way is Way => way !== undefined)
    .sort((left, right) => wayLengthMeters(right) - wayLengthMeters(left));
  if (ordered.length < 2) return { system, absorbed: 0 };

  let next = system;
  let absorbed = 0;
  const keepers = new Set([ordered[0].id]);
  for (const way of ordered.slice(1)) {
    next = conflateWay(next, way, ordered[0], keepers);
    if (next.ways.some((candidate) => candidate.id === way.id)) keepers.add(way.id);
    else absorbed++;
  }
  return { system: absorbed > 0 ? next : system, absorbed };
}
