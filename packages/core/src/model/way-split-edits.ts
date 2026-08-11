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
import { replacedStationAnchors } from './station-reanchoring';
import type { LngLat, Node, Station, TransitSystem, Way } from './system';
import { remapWayEndpointMetadata, remapWaySplitTurnTargets } from './way-endpoint-metadata';
import { insertWayPoint } from './way-point-edits';

export type CreateWaySplitId = () => string;

/** @internal Result used by core workflows that must identify the new half. */
interface WaySplitOperationResult {
  system: TransitSystem;
  newWayId: string;
}

function mapPreservingReference<Value>(values: Value[], update: (value: Value) => Value): Value[] {
  let changed = false;
  const next: Value[] = [];
  for (const value of values) {
    const updated = update(value);
    if (updated !== value) changed = true;
    next.push(updated);
  }
  return changed ? next : values;
}

function splitServices(
  system: TransitSystem,
  wayId: string,
  newWayId: string,
  t: number,
): TransitSystem['services'] {
  return mapPreservingReference(system.services, (service) => {
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
  return mapPreservingReference(stations, (station) => {
    if (!anchorOnWayId(station, wayId)) return station;
    const onFirst = nearestOnPath(firstPath, station.coord);
    const onSecond = nearestOnPath(secondPath, station.coord);
    const useSecond = !!onSecond && (!onFirst || onSecond.distMeters < onFirst.distMeters);
    const nearest = useSecond ? onSecond : onFirst;
    if (!nearest) return station;
    return {
      ...station,
      anchors: replacedStationAnchors(station, wayId, {
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

interface SplitNodesOptions {
  way: Way;
  index: number;
  newWayId: string;
  createId: CreateWaySplitId;
}

function splitNodes(nodes: Node[], options: SplitNodesOptions): Node[] {
  const { way, index, newWayId, createId } = options;
  let next = nodes.map((node) => {
    if (!node.refs.some((ref) => ref.wayId === way.id && ref.pointIndex >= index)) return node;
    return {
      ...node,
      refs: node.refs.flatMap((ref) => {
        if (ref.wayId !== way.id || ref.pointIndex < index) return [ref];
        if (ref.pointIndex === index) return [ref, { wayId: newWayId, pointIndex: 0 }];
        return [{ wayId: newWayId, pointIndex: ref.pointIndex - index }];
      }),
    };
  });
  const alreadyLinked = next.some(
    (node) =>
      node.refs.some((ref) => ref.wayId === way.id && ref.pointIndex === index) &&
      node.refs.some((ref) => ref.wayId === newWayId && ref.pointIndex === 0),
  );
  if (!alreadyLinked) {
    next = [
      ...next,
      {
        id: createId(),
        coord: way.points[index],
        refs: [
          { wayId: way.id, pointIndex: index },
          { wayId: newWayId, pointIndex: 0 },
        ],
      },
    ];
  }
  return remapSplitConnectors(next, way.id, newWayId);
}

/**
 * Splits a way at an existing control point, repairs its dependents, and
 * reports the identity it creates for internal workflows.
 * @internal
 */
export function splitWayAtIndexResult(
  system: TransitSystem,
  wayId: string,
  index: number,
  createId: CreateWaySplitId = shortId,
): WaySplitOperationResult | null {
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way || index <= 0 || index >= way.points.length - 1) return null;

  const newWayId = createId();
  const first: Way = { ...way, points: way.points.slice(0, index + 1) };
  const second: Way = { ...way, id: newWayId, points: way.points.slice(index) };
  const ways = [
    ...system.ways.map((candidate) => (candidate.id === wayId ? first : candidate)),
    second,
  ];

  const nodes = splitNodes(system.nodes, { way, index, newWayId, createId });

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
  const namedWays = mapPreservingReference(system.namedWays, (namedWay) =>
    namedWay.wayIds.includes(wayId)
      ? { ...namedWay, wayIds: [...namedWay.wayIds, newWayId] }
      : namedWay,
  );
  const endpointMetadata = remapWayEndpointMetadata(system, [
    {
      source: way,
      start: { way: first, end: 'start' },
      end: { way: second, end: 'end' },
    },
  ]);
  const turnRestrictions = remapWaySplitTurnTargets(system, endpointMetadata.turnRestrictions, {
    sourceWayId: wayId,
    splitIndex: index,
    newWayId,
  });

  return {
    newWayId,
    system: {
      ...system,
      ways,
      nodes,
      services,
      stations,
      namedWays,
      ...endpointMetadata,
      turnRestrictions,
    },
  };
}

export function splitWayAtIndex(
  system: TransitSystem,
  wayId: string,
  index: number,
  createId: CreateWaySplitId = shortId,
): TransitSystem {
  return splitWayAtIndexResult(system, wayId, index, createId)?.system ?? system;
}

/**
 * Splits at normalized distance, inserting a real control point when needed,
 * and reports the identity it creates for internal workflows.
 * @internal
 */
export function splitWayAtPositionResult(
  system: TransitSystem,
  wayId: string,
  t: number,
  createId: CreateWaySplitId = shortId,
): WaySplitOperationResult | null {
  if (!Number.isFinite(t) || t <= 0 || t >= 1) return null;
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way) return null;
  const path = resolveWayPath(way);
  if (path.length < 2) return null;
  const coord = pointAtT(path, t);
  const existing = way.points.findIndex((point) => haversineMeters(point, coord) < 0.75);
  if (existing === 0 || existing === way.points.length - 1) return null;
  if (existing > 0) return splitWayAtIndexResult(system, wayId, existing, createId);

  const insertion = nearestInsertionPoint(way.points, coord);
  if (!insertion || insertion.index <= 0 || insertion.index >= way.points.length) return null;
  const inserted = insertWayPoint(system, wayId, insertion.index, coord);
  return splitWayAtIndexResult(inserted, wayId, insertion.index, createId);
}

export function splitWayAtPosition(
  system: TransitSystem,
  wayId: string,
  t: number,
  createId: CreateWaySplitId = shortId,
): TransitSystem {
  return splitWayAtPositionResult(system, wayId, t, createId)?.system ?? system;
}
