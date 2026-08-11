import { INTERCHANGE_METERS, nearestOnPath, resolveWayPath } from '../model/geo';
import type { Station, Way } from '../model/system';
import type { ColdPlanContext } from './render-preparation-cold-types';
import { queryColdPreparedViewportCategory } from './render-preparation-viewport';

export interface NearWaySearchBounds {
  readonly bounds: [[number, number], [number, number]];
  readonly marginDegrees: number;
}

/** Bounds a changed corridor set for incremental station dependency repair. */
export function nearWaySearchBounds(ways: readonly Way[]): NearWaySearchBounds | null {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const way of ways) {
    for (const [longitude, latitude] of resolveWayPath(way)) {
      west = Math.min(west, longitude);
      south = Math.min(south, latitude);
      east = Math.max(east, longitude);
      north = Math.max(north, latitude);
    }
  }
  if (!Number.isFinite(west)) return null;
  const middleLatitude = (south + north) / 2;
  const latitudeDegrees = INTERCHANGE_METERS / 111_320;
  const longitudeDegrees =
    INTERCHANGE_METERS / (111_320 * Math.max(Math.cos((middleLatitude * Math.PI) / 180), 0.01));
  return {
    bounds: [
      [west, south],
      [east, north],
    ],
    marginDegrees: Math.max(latitudeDegrees, longitudeDegrees),
  };
}

export function nearWayCandidateIds(context: ColdPlanContext, station: Station): readonly string[] {
  const latitudeDegrees = INTERCHANGE_METERS / 111_320;
  const longitudeDegrees =
    INTERCHANGE_METERS / (111_320 * Math.max(Math.cos((station.coord[1] * Math.PI) / 180), 0.01));
  const corridor = context.coldViewport.get('corridor');
  return corridor
    ? queryColdPreparedViewportCategory(
        corridor,
        [station.coord, station.coord],
        Math.max(latitudeDegrees, longitudeDegrees),
      )
    : [];
}

export function exactNearWayIds(
  context: ColdPlanContext,
  station: Station,
  candidateIds: readonly string[],
): readonly string[] {
  const ranked = candidateIds.flatMap((id) => {
    const way = context.domain.waysById.get(id);
    if (!way) return [];
    const nearest = nearestOnPath(resolveWayPath(way), station.coord);
    return nearest && nearest.distMeters <= INTERCHANGE_METERS
      ? [{ id, distance: nearest.distMeters }]
      : [];
  });
  ranked.sort(
    (left, right) =>
      left.distance - right.distance || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  return ranked.map(({ id }) => id);
}
