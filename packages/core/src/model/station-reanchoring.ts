import { anchorOnWayId, nearestOnPath, resolveWayPath } from './geo';
import type { Station, StationAnchor, TransitSystem } from './system';

const COORDINATE_IDENTITY_TOLERANCE_M = 1e-6;
const ANCHOR_IDENTITY_TOLERANCE = 1e-12;

export interface ReplacementWayReanchoringOptions {
  replacedWayIds: ReadonlySet<string>;
  replacementWayIds: ReadonlySet<string>;
  maxDistanceM: number;
}

/** Replace one way attachment and keep at most one attachment to the destination way. */
export function replacedStationAnchors(
  station: Station,
  replacedWayId: string,
  next: StationAnchor,
): StationAnchor[] {
  const kept = station.anchors.filter(
    (anchor) => anchor.wayId !== replacedWayId && anchor.wayId !== next.wayId,
  );
  const anchors = [next, ...kept];
  return anchors.length === station.anchors.length &&
    anchors.every(
      (anchor, index) =>
        anchor.wayId === station.anchors[index].wayId && anchor.t === station.anchors[index].t,
    )
    ? station.anchors
    : anchors;
}

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

/**
 * Move station attachments away from Ways that are about to be removed.
 * Stations too far from every replacement Way stay in the document but become
 * detached from the removed geometry.
 */
export function reanchorStationsToReplacementWays(
  system: TransitSystem,
  options: ReplacementWayReanchoringOptions,
): Station[] {
  if (options.replacedWayIds.size === 0) return system.stations;
  const replacements = system.ways
    .filter((way) => options.replacementWayIds.has(way.id))
    .map((way) => ({ id: way.id, path: resolveWayPath(way) }));
  const stations = system.stations.map((station) => {
    if (!station.anchors.some((anchor) => options.replacedWayIds.has(anchor.wayId))) {
      return station;
    }

    let replacement: StationAnchor | undefined;
    let bestDistance = options.maxDistanceM;
    for (const way of replacements) {
      const nearest = nearestOnPath(way.path, station.coord);
      if (!nearest || nearest.distMeters >= bestDistance) continue;
      bestDistance = nearest.distMeters;
      replacement = { wayId: way.id, t: nearest.t };
    }

    const retained = station.anchors.filter((anchor) => !options.replacedWayIds.has(anchor.wayId));
    const anchors = replacement
      ? [replacement, ...retained.filter((anchor) => anchor.wayId !== replacement.wayId)]
      : retained;
    return { ...station, anchors };
  });
  return stations.some((station, index) => station !== system.stations[index])
    ? stations
    : system.stations;
}
