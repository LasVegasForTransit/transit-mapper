import {
  anchorOnWayId,
  haversineMeters,
  nearestOnPath,
  patternLegs,
  pointAtT,
  resolveWayPath,
} from './geo';
import { mapSectionLegs, mergeLegs, normalizeSections } from './patternEdits';
import { withServicePattern } from './line-service';
import type { LngLat, Node, Station, StationAnchor, TransitSystem, Way } from './system';

const JOIN_TOLERANCE_M = 0.75;

type JoinOrder = 'ab' | 'ab-reversed' | 'ba' | 'b-reversed-a';

interface PointMerge {
  points: LngLat[];
  order: JoinOrder;
  mapFirst(index: number): number;
  mapSecond(index: number): number;
}

function mergedPoints(first: Way, second: Way): PointMerge | null {
  const firstLength = first.points.length;
  const secondLength = second.points.length;
  const firstStart = first.points[0];
  const firstEnd = first.points[firstLength - 1];
  const secondStart = second.points[0];
  const secondEnd = second.points[secondLength - 1];
  const order = [
    { distance: haversineMeters(firstEnd, secondStart), order: 'ab' as const },
    { distance: haversineMeters(firstEnd, secondEnd), order: 'ab-reversed' as const },
    { distance: haversineMeters(firstStart, secondEnd), order: 'ba' as const },
    { distance: haversineMeters(firstStart, secondStart), order: 'b-reversed-a' as const },
  ].sort((left, right) => left.distance - right.distance)[0];
  if (order.distance > JOIN_TOLERANCE_M) return null;
  const reversed = [...second.points].reverse();
  if (order.order === 'ab') {
    return {
      points: [...first.points, ...second.points.slice(1)],
      order: order.order,
      mapFirst: (index) => index,
      mapSecond: (index) => firstLength - 1 + index,
    };
  }
  if (order.order === 'ab-reversed') {
    return {
      points: [...first.points, ...reversed.slice(1)],
      order: order.order,
      mapFirst: (index) => index,
      mapSecond: (index) => firstLength - 1 + (secondLength - 1 - index),
    };
  }
  if (order.order === 'ba') {
    return {
      points: [...second.points, ...first.points.slice(1)],
      order: order.order,
      mapFirst: (index) => secondLength - 1 + index,
      mapSecond: (index) => index,
    };
  }
  return {
    points: [...reversed, ...first.points.slice(1)],
    order: order.order,
    mapFirst: (index) => secondLength - 1 + index,
    mapSecond: (index) => secondLength - 1 - index,
  };
}

function mergedNodes(nodes: Node[], keepId: string, otherId: string, merge: PointMerge): Node[] {
  return nodes.flatMap((node) => {
    const refs = node.refs.map((ref) =>
      ref.wayId === keepId
        ? { wayId: keepId, pointIndex: merge.mapFirst(ref.pointIndex) }
        : ref.wayId === otherId
          ? { wayId: keepId, pointIndex: merge.mapSecond(ref.pointIndex) }
          : ref,
    );
    const seen = new Set<string>();
    const deduped = refs.filter((ref) => {
      const key = `${ref.wayId}:${ref.pointIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (deduped.length < 2) return [];
    const connectors = node.connectors?.filter(
      (connector) => connector.from.wayId !== otherId && connector.to.wayId !== otherId,
    );
    return [
      {
        ...node,
        refs: deduped,
        connectors: connectors && connectors.length > 0 ? connectors : undefined,
      },
    ];
  });
}

function reanchored(station: Station, replacedWayId: string, next: StationAnchor): StationAnchor[] {
  const kept = station.anchors.filter(
    (anchor) => anchor.wayId !== replacedWayId && anchor.wayId !== next.wayId,
  );
  return [next, ...kept];
}

/** Joins compatible ways end-to-end and repairs all dependent references. */
export function mergeWaysEndToEnd(
  system: TransitSystem,
  keepId: string,
  otherId: string,
): TransitSystem {
  const first = system.ways.find((way) => way.id === keepId);
  const second = system.ways.find((way) => way.id === otherId);
  if (
    !first ||
    !second ||
    first === second ||
    first.typeId !== second.typeId ||
    first.points.length < 2 ||
    second.points.length < 2
  ) {
    return system;
  }
  const merge = mergedPoints(first, second);
  if (!merge) return system;
  const mergedWay: Way = { ...first, points: merge.points };
  const ways = system.ways
    .filter((way) => way.id !== otherId)
    .map((way) => (way.id === keepId ? mergedWay : way));
  const nodes = mergedNodes(system.nodes, keepId, otherId, merge);
  const mergedPath = resolveWayPath(mergedWay);
  const oldPaths = new Map([
    [keepId, resolveWayPath(first)],
    [otherId, resolveWayPath(second)],
  ]);
  const reversedSecond = merge.order === 'ab-reversed' || merge.order === 'b-reversed-a';
  const services = system.services.map((service) => {
    const pattern = service.path;
    if (!patternLegs(pattern).some((leg) => leg.wayId === keepId || leg.wayId === otherId)) {
      return service;
    }
    return withServicePattern(service, {
      ...pattern,
      sections: normalizeSections(
        mapSectionLegs(pattern.sections, (legs) =>
          mergeLegs(legs, keepId, otherId, {
            positionOf: (wayId, t) => {
              const oldPath = oldPaths.get(wayId);
              if (!oldPath || oldPath.length < 2) return t;
              return nearestOnPath(mergedPath, pointAtT(oldPath, t))?.t ?? t;
            },
            reversed: (wayId) => wayId === otherId && reversedSecond,
          }),
        ),
      ),
    });
  });
  const stations = system.stations.map((station) => {
    if (!anchorOnWayId(station, keepId) && !anchorOnWayId(station, otherId)) return station;
    const nearest = nearestOnPath(mergedPath, station.coord);
    return nearest
      ? {
          ...station,
          anchors: reanchored(station, otherId, { wayId: keepId, t: nearest.t }),
        }
      : station;
  });
  const namedWays = system.namedWays.flatMap((namedWay) => {
    if (!namedWay.wayIds.includes(otherId)) return [namedWay];
    const wayIds = namedWay.wayIds.filter((wayId) => wayId !== otherId);
    return wayIds.length > 0 ? [{ ...namedWay, wayIds }] : [];
  });
  return { ...system, ways, nodes, services, stations, namedWays };
}
