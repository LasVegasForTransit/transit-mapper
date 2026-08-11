import {
  anchorOnWayId,
  haversineMeters,
  nearestInsertionPoint,
  nearestOnPath,
  pathLengthMeters,
  patternLegs,
  pointAtT,
  resolveWayPath,
} from './geo';
import { shortId } from './ids';
import { withServicePattern } from './line-service';
import { mapSectionLegs, normalizeSections, splitLegs } from './patternEdits';
import type { LngLat, Node, Station, StationAnchor, TransitSystem, Way } from './system';
import { insertWayPoint } from './way-point-edits';

export type CreateWaySplitId = () => string;

function reanchored(station: Station, replacedWayId: string, next: StationAnchor): StationAnchor[] {
  const kept = station.anchors.filter(
    (anchor) => anchor.wayId !== replacedWayId && anchor.wayId !== next.wayId,
  );
  return [next, ...kept];
}

function splitServices(
  system: TransitSystem,
  wayId: string,
  newWayId: string,
  t: number,
): TransitSystem['services'] {
  return system.services.map((service) => {
    const pattern = service.path;
    if (!patternLegs(pattern).some((leg) => leg.wayId === wayId)) return service;
    return withServicePattern(service, {
      ...pattern,
      sections: normalizeSections(
        mapSectionLegs(pattern.sections, (legs) => splitLegs(legs, wayId, newWayId, t)),
      ),
    });
  });
}

interface SplitStationOptions {
  wayId: string;
  newWayId: string;
  firstPath: LngLat[];
  secondPath: LngLat[];
}

function splitStations(stations: Station[], options: SplitStationOptions): Station[] {
  const { wayId, newWayId, firstPath, secondPath } = options;
  return stations.map((station) => {
    if (!anchorOnWayId(station, wayId)) return station;
    const onFirst = nearestOnPath(firstPath, station.coord);
    const onSecond = nearestOnPath(secondPath, station.coord);
    const useSecond = !!onSecond && (!onFirst || onSecond.distMeters < onFirst.distMeters);
    const nearest = useSecond ? onSecond : onFirst;
    if (!nearest) return station;
    return {
      ...station,
      anchors: reanchored(station, wayId, {
        wayId: useSecond ? newWayId : wayId,
        t: nearest.t,
      }),
    };
  });
}

function remapSplitConnectors(nodes: Node[], wayId: string, newWayId: string): Node[] {
  return nodes.map((node) => {
    if (!node.connectors || node.refs.some((ref) => ref.wayId === wayId)) return node;
    return {
      ...node,
      connectors: node.connectors.map((connector) => ({
        from:
          connector.from.wayId === wayId ? { ...connector.from, wayId: newWayId } : connector.from,
        to: connector.to.wayId === wayId ? { ...connector.to, wayId: newWayId } : connector.to,
      })),
    };
  });
}

/**
 * Splits a way at an existing control point and repairs every dependent
 * service, station, node, connector, and shared street identity.
 */
export function splitWayAtIndex(
  system: TransitSystem,
  wayId: string,
  index: number,
  createId: CreateWaySplitId = shortId,
): TransitSystem {
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way || index <= 0 || index >= way.points.length - 1) return system;

  const newWayId = createId();
  const first: Way = { ...way, points: way.points.slice(0, index + 1) };
  const second: Way = { ...way, id: newWayId, points: way.points.slice(index) };
  const ways = [
    ...system.ways.map((candidate) => (candidate.id === wayId ? first : candidate)),
    second,
  ];

  let nodes = system.nodes.map((node) => {
    if (!node.refs.some((ref) => ref.wayId === wayId && ref.pointIndex >= index)) return node;
    return {
      ...node,
      refs: node.refs.flatMap((ref) => {
        if (ref.wayId !== wayId || ref.pointIndex < index) return [ref];
        if (ref.pointIndex === index) return [ref, { wayId: newWayId, pointIndex: 0 }];
        return [{ wayId: newWayId, pointIndex: ref.pointIndex - index }];
      }),
    };
  });
  const splitAlreadyLinked = nodes.some(
    (node) =>
      node.refs.some((ref) => ref.wayId === wayId && ref.pointIndex === index) &&
      node.refs.some((ref) => ref.wayId === newWayId && ref.pointIndex === 0),
  );
  if (!splitAlreadyLinked) {
    nodes = [
      ...nodes,
      {
        id: createId(),
        coord: way.points[index],
        refs: [
          { wayId, pointIndex: index },
          { wayId: newWayId, pointIndex: 0 },
        ],
      },
    ];
  }

  const firstPath = resolveWayPath(first);
  const secondPath = resolveWayPath(second);
  const originalPath = resolveWayPath(way);
  const splitT =
    nearestOnPath(originalPath, way.points[index])?.t ??
    pathLengthMeters(firstPath) / Math.max(1e-9, pathLengthMeters(originalPath));
  const services = splitServices(system, wayId, newWayId, splitT);
  const stations = splitStations(system.stations, {
    wayId,
    newWayId,
    firstPath,
    secondPath,
  });
  nodes = remapSplitConnectors(nodes, wayId, newWayId);
  const namedWays = system.namedWays.map((namedWay) =>
    namedWay.wayIds.includes(wayId)
      ? { ...namedWay, wayIds: [...namedWay.wayIds, newWayId] }
      : namedWay,
  );

  return { ...system, ways, nodes, services, stations, namedWays };
}

/** Splits at normalized distance, inserting a real control point when needed. */
export function splitWayAtPosition(
  system: TransitSystem,
  wayId: string,
  t: number,
  createId: CreateWaySplitId = shortId,
): TransitSystem {
  if (!Number.isFinite(t) || t <= 0 || t >= 1) return system;
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way) return system;
  const path = resolveWayPath(way);
  if (path.length < 2) return system;
  const coord = pointAtT(path, t);
  const existing = way.points.findIndex((point) => haversineMeters(point, coord) < 0.75);
  if (existing === 0 || existing === way.points.length - 1) return system;
  if (existing > 0) return splitWayAtIndex(system, wayId, existing, createId);

  const insertion = nearestInsertionPoint(way.points, coord);
  if (!insertion || insertion.index <= 0 || insertion.index >= way.points.length) return system;
  const inserted = insertWayPoint(system, wayId, insertion.index, coord);
  return splitWayAtIndex(inserted, wayId, insertion.index, createId);
}
