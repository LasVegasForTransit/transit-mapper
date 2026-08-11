import { anchorOnWayId, nearestOnPath, resolveWayPath } from './geo';
import type { Station, TransitSystem } from './system';

const COORDINATE_IDENTITY_TOLERANCE_M = 1e-6;
const ANCHOR_IDENTITY_TOLERANCE = 1e-12;

/**
 * Reproject every station riding `wayId` from its last known coordinate onto
 * that way's current path.
 *
 * The coordinate, rather than the stored `t`, is the stable input when a way's
 * total length changes: extending a far endpoint must not drag a station whose
 * local geometry stayed put. This transform is runtime- and timestamp-neutral
 * and preserves the input collection when reprojection changes no station.
 */
export function reanchorStationsOnWay(system: TransitSystem, wayId: string): Station[] {
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way) return system.stations;
  const path = resolveWayPath(way);
  if (path.length < 2) return system.stations;

  const stations = system.stations.map((station) => {
    const anchor = anchorOnWayId(station, wayId);
    if (!anchor) return station;
    const projected = nearestOnPath(path, station.coord);
    if (!projected) return station;
    if (
      Math.abs(anchor.t - projected.t) <= ANCHOR_IDENTITY_TOLERANCE &&
      projected.distMeters <= COORDINATE_IDENTITY_TOLERANCE_M
    ) {
      return station;
    }

    return {
      ...station,
      coord: projected.coord,
      anchors: station.anchors.map((candidate) =>
        candidate === anchor ? { ...candidate, t: projected.t } : candidate,
      ),
    };
  });
  return stations.some((station, index) => station !== system.stations[index])
    ? stations
    : system.stations;
}
