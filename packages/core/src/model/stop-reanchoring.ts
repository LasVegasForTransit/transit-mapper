import { anchorOnWayId, nearestOnPath, resolveWayPath } from './geo';
import type { Stop, StopAnchor, TransitSystem } from './system';

const COORDINATE_IDENTITY_TOLERANCE_M = 1e-6;
const ANCHOR_IDENTITY_TOLERANCE = 1e-12;

export interface ReplacementWayReanchoringOptions {
  replacedWayIds: ReadonlySet<string>;
  replacementWayIds: ReadonlySet<string>;
  maxDistanceM: number;
}

/** Replace one way attachment and keep at most one attachment to the destination way. */
export function replacedStopAnchors(
  stop: Stop,
  replacedWayId: string,
  next: StopAnchor,
): StopAnchor[] {
  const kept = stop.anchors.filter(
    (anchor) => anchor.wayId !== replacedWayId && anchor.wayId !== next.wayId,
  );
  const anchors = [next, ...kept];
  return anchors.length === stop.anchors.length &&
    anchors.every(
      (anchor, index) =>
        anchor.wayId === stop.anchors[index].wayId && anchor.t === stop.anchors[index].t,
    )
    ? stop.anchors
    : anchors;
}

/**
 * Reproject every stop riding `wayId` from its last known coordinate onto
 * that way's current path.
 *
 * The coordinate, rather than the stored `t`, is the stable input when a way's
 * total length changes: extending a far endpoint must not drag a stop whose
 * local geometry stayed put. This transform is runtime- and timestamp-neutral
 * and preserves the input collection when reprojection changes no stop.
 */
export function reanchorStopsOnWay(system: TransitSystem, wayId: string): Stop[] {
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way) return system.stops;
  const path = resolveWayPath(way);
  if (path.length < 2) return system.stops;

  const stops = system.stops.map((stop) => {
    const anchor = anchorOnWayId(stop, wayId);
    if (!anchor) return stop;
    const projected = nearestOnPath(path, stop.coord);
    if (!projected) return stop;
    if (
      Math.abs(anchor.t - projected.t) <= ANCHOR_IDENTITY_TOLERANCE &&
      projected.distMeters <= COORDINATE_IDENTITY_TOLERANCE_M
    ) {
      return stop;
    }

    return {
      ...stop,
      coord: projected.coord,
      anchors: stop.anchors.map((candidate) =>
        candidate === anchor ? { ...candidate, t: projected.t } : candidate,
      ),
    };
  });
  return stops.some((stop, index) => stop !== system.stops[index]) ? stops : system.stops;
}

/**
 * Move stop attachments away from Ways that are about to be removed.
 * Stops too far from every replacement Way stay in the document but become
 * detached from the removed geometry.
 */
export function reanchorStopsToReplacementWays(
  system: TransitSystem,
  options: ReplacementWayReanchoringOptions,
): Stop[] {
  if (options.replacedWayIds.size === 0) return system.stops;
  const replacements = system.ways
    .filter((way) => options.replacementWayIds.has(way.id))
    .map((way) => ({ id: way.id, path: resolveWayPath(way) }));
  const stops = system.stops.map((stop) => {
    if (!stop.anchors.some((anchor) => options.replacedWayIds.has(anchor.wayId))) {
      return stop;
    }

    let replacement: StopAnchor | undefined;
    let bestDistance = options.maxDistanceM;
    for (const way of replacements) {
      const nearest = nearestOnPath(way.path, stop.coord);
      if (!nearest || nearest.distMeters >= bestDistance) continue;
      bestDistance = nearest.distMeters;
      replacement = { wayId: way.id, t: nearest.t };
    }

    const retained = stop.anchors.filter((anchor) => !options.replacedWayIds.has(anchor.wayId));
    const anchors = replacement
      ? [replacement, ...retained.filter((anchor) => anchor.wayId !== replacement.wayId)]
      : retained;
    return { ...stop, anchors };
  });
  return stops.some((stop, index) => stop !== system.stops[index]) ? stops : system.stops;
}
