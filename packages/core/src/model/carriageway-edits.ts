import { LANE_KINDS, laneKind } from './catalog';
import { getComponent, withComponent, withoutComponent } from './components';
import {
  anchorOnWayId,
  haversineMeters,
  nearestOnPath,
  offsetPolyline,
  patternLegs,
  pointAtT,
  resolveWayPath,
  snap,
} from './geo';
import { shortId } from './ids';
import { withServicePattern } from './line-service';
import { mapSectionLegs, mergeLegs, normalizeSections } from './patternEdits';
import {
  combineProfiles,
  directionalLanes,
  flipProfile,
  profileWidthM,
  separateProfiles,
} from './profile';
import { reanchorStationsOnWay, replacedStationAnchors } from './station-reanchoring';
import type { LaneConnector, LngLat, NamedWay, Node, TransitSystem, Way } from './system';
import { remapWayEndpointMetadata, type WayEndpointRemap } from './way-endpoint-metadata';
import { joinWayPointToWay } from './way-point-edits';
import { removeWayFromSystem } from './way-removal';

const RECONNECT_DISTANCE_M = 50;

export type CreateCarriagewayId = () => string;

export interface SeparateCarriagewayResult {
  system: TransitSystem;
  newWayId: string;
}

function separatedIdentity(
  system: TransitSystem,
  wayId: string,
  newWayId: string,
  createId: CreateCarriagewayId,
): { namedWays: NamedWay[]; namedWayId: string } {
  const current = system.namedWays.find((namedWay) => namedWay.wayIds.includes(wayId));
  if (current) {
    return {
      namedWayId: current.id,
      namedWays: system.namedWays.map((namedWay) =>
        namedWay === current ? { ...namedWay, wayIds: [...namedWay.wayIds, newWayId] } : namedWay,
      ),
    };
  }
  const namedWayId = createId();
  return {
    namedWayId,
    namedWays: [...system.namedWays, { id: namedWayId, name: '', wayIds: [wayId, newWayId] }],
  };
}

function reconnectCarriagewayEnds(
  system: TransitSystem,
  way: Way,
  forwardWayId: string,
  createId: CreateCarriagewayId,
): TransitSystem {
  let next = system;
  const excluded = new Set([forwardWayId, way.id]);
  const lastIndex = way.points.length - 1;
  for (const index of [0, lastIndex]) {
    const point = way.points[index];
    const target = snap(next.ways, point, RECONNECT_DISTANCE_M, excluded, way.typeId);
    if (!target) continue;
    next = joinWayPointToWay(
      next,
      { wayId: way.id, index, targetWayId: target.wayId, coord: target.coord },
      createId,
    );
  }
  return next;
}

/** Splits a two-way profile into offset one-way carriageways. */
export function separateCarriageways(
  system: TransitSystem,
  wayId: string,
  createId: CreateCarriagewayId = shortId,
): SeparateCarriagewayResult | null {
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way || way.points.length < 2) return null;
  const profiles = separateProfiles(way.profile, system.drivingSide);
  if (!profiles) return null;
  const medianLane = way.profile.lanes.find((lane) => laneKind(lane.kindId).role === 'separator');
  const medianWidth = medianLane?.widthM ?? 0;
  const gap = Math.max(medianWidth, LANE_KINDS.median.defaultWidthM);
  const distance = profileWidthM(profiles.forward) / 2 + gap + profileWidthM(profiles.backward) / 2;
  const newWayId = createId();
  const offset = system.drivingSide === 'left' ? distance : -distance;
  const backward: Way = {
    ...way,
    id: newWayId,
    points: offsetPolyline(way.points, offset),
    profile: profiles.backward,
  };
  const identity = separatedIdentity(system, wayId, newWayId, createId);
  const medians = withComponent(system.medians, identity.namedWayId, {
    widthM: gap,
    kindId: medianLane?.kindId ?? 'median',
  });
  const separated: TransitSystem = {
    ...system,
    ways: [
      ...system.ways.map((candidate) =>
        candidate.id === wayId ? { ...candidate, profile: profiles.forward } : candidate,
      ),
      backward,
    ],
    namedWays: identity.namedWays,
    medians,
  };
  return {
    system: reconnectCarriagewayEnds(separated, backward, wayId, createId),
    newWayId,
  };
}
type CarriagewayDirection = 'forward' | 'backward';

function oneWayDirection(profile: Way['profile']): CarriagewayDirection | null {
  const directions = [...new Set(directionalLanes(profile).map((lane) => lane.direction))];
  const direction = directions.length === 1 ? directions[0] : null;
  return direction === 'forward' || direction === 'backward' ? direction : null;
}

function samePointDirection(first: Way, second: Way): boolean {
  const same =
    haversineMeters(first.points[0], second.points[0]) +
    haversineMeters(first.points[first.points.length - 1], second.points[second.points.length - 1]);
  const opposite =
    haversineMeters(first.points[0], second.points[second.points.length - 1]) +
    haversineMeters(first.points[first.points.length - 1], second.points[0]);
  return same <= opposite;
}

function nearestPointIndex(points: LngLat[], coord: LngLat): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  points.forEach((point, index) => {
    const distance = haversineMeters(point, coord);
    if (distance >= bestDistance) return;
    bestDistance = distance;
    bestIndex = index;
  });
  return bestIndex;
}

function remapConnector(
  connector: LaneConnector,
  otherWayId: string,
  keeperWayId: string,
): LaneConnector {
  const from =
    connector.from.wayId === otherWayId
      ? { ...connector.from, wayId: keeperWayId }
      : connector.from;
  const to =
    connector.to.wayId === otherWayId ? { ...connector.to, wayId: keeperWayId } : connector.to;
  return from === connector.from && to === connector.to ? connector : { from, to };
}

function uniqueRefs(refs: Node['refs']): Node['refs'] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.wayId}:${ref.pointIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueConnectors(connectors: LaneConnector[]): LaneConnector[] {
  const seen = new Set<string>();
  return connectors.filter((connector) => {
    const key = `${connector.from.wayId}:${connector.from.laneId}>${connector.to.wayId}:${connector.to.laneId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface CollapsedJunctions {
  ways: Way[];
  nodes: Node[];
  movedWayIds: string[];
}

function collapsedJunctions(
  ways: Way[],
  nodes: Node[],
  keeper: Way,
  other: Way,
): CollapsedJunctions {
  const movedPoints = new Map<string, Map<number, LngLat>>();
  const remappedNodes = nodes
    .map((node) => {
      const otherRefs = node.refs.filter((ref) => ref.wayId === other.id);
      if (otherRefs.length === 0) return node;
      const refs = uniqueRefs(
        node.refs.map((ref) =>
          ref.wayId === other.id
            ? {
                wayId: keeper.id,
                pointIndex: nearestPointIndex(keeper.points, other.points[ref.pointIndex]),
              }
            : ref,
        ),
      );
      const keeperRef = refs.find((ref) => ref.wayId === keeper.id);
      const coord = keeperRef ? keeper.points[keeperRef.pointIndex] : node.coord;
      if (refs.length >= 2 && keeperRef) {
        for (const ref of refs) {
          const indexes = movedPoints.get(ref.wayId) ?? new Map<number, LngLat>();
          indexes.set(ref.pointIndex, coord);
          movedPoints.set(ref.wayId, indexes);
        }
      }
      const connectors = node.connectors
        ? uniqueConnectors(
            node.connectors.map((connector) => remapConnector(connector, other.id, keeper.id)),
          )
        : undefined;
      return { ...node, coord, refs, ...(connectors ? { connectors } : {}) };
    })
    .filter((node) => node.refs.length >= 2);
  const remappedWays = ways.map((way) => {
    const indexes = movedPoints.get(way.id);
    if (!indexes) return way;
    const points = way.points.map((point, index) => indexes.get(index) ?? point);
    return points.every((point, index) => point === way.points[index]) ? way : { ...way, points };
  });
  return { ways: remappedWays, nodes: remappedNodes, movedWayIds: [...movedPoints.keys()] };
}

function reanchorMovedWays(
  system: TransitSystem,
  ways: Way[],
  stations: TransitSystem['stations'],
  wayIds: string[],
): TransitSystem['stations'] {
  let nextStations = stations;
  for (const wayId of wayIds) {
    const next = { ...system, ways, stations: nextStations };
    nextStations = reanchorStationsOnWay(next, wayId);
  }
  return nextStations;
}

interface CarriagewayPair {
  keeper: Way;
  other: Way;
  sameDirection: boolean;
  backwardProfile: Way['profile'];
  forwardProfile: Way['profile'];
}

function namedCarriagewayWays(
  system: TransitSystem,
  namedWayId: string,
): readonly [Way, Way] | null {
  const identity = system.namedWays.find((namedWay) => namedWay.id === namedWayId);
  if (identity?.wayIds.length !== 2) return null;
  const first = system.ways.find((way) => way.id === identity.wayIds[0]);
  const second = system.ways.find((way) => way.id === identity.wayIds[1]);
  if (!first?.points[1] || !second?.points[1]) return null;
  if (first.typeId !== second.typeId) return null;
  return [first, second];
}

function carriagewayPair(system: TransitSystem, namedWayId: string): CarriagewayPair | null {
  const ways = namedCarriagewayWays(system, namedWayId);
  if (!ways) return null;
  const [first, second] = ways;
  const firstDirection = oneWayDirection(first.profile);
  const secondDirection = oneWayDirection(second.profile);
  if (!firstDirection || !secondDirection) return null;
  let [keeper, other] = [first, second];
  if (firstDirection === 'backward' && secondDirection === 'forward')
    [keeper, other] = [second, first];
  const sameDirection = samePointDirection(keeper, other);
  const alignedOtherProfile = sameDirection ? other.profile : flipProfile(other.profile);
  const keeperDirection = oneWayDirection(keeper.profile);
  const otherDirection = oneWayDirection(alignedOtherProfile);
  if (!keeperDirection || !otherDirection || keeperDirection === otherDirection) return null;
  const profiles = {
    [keeperDirection]: keeper.profile,
    [otherDirection]: alignedOtherProfile,
  } as Record<CarriagewayDirection, Way['profile']>;
  return {
    keeper,
    other,
    sameDirection,
    backwardProfile: profiles.backward,
    forwardProfile: profiles.forward,
  };
}

function carriagewayEndpointRemap(
  source: Way,
  destination: Way,
  sameDirection: boolean,
): WayEndpointRemap {
  const endpoint = (end: 'start' | 'end') => ({ way: destination, end });
  return {
    source,
    start: endpoint(sameDirection ? 'start' : 'end'),
    end: endpoint(sameDirection ? 'end' : 'start'),
  };
}

/** Collapses a one-way pair back onto its forward carriageway. */
export function combineCarriageways(system: TransitSystem, namedWayId: string): TransitSystem {
  const pair = carriagewayPair(system, namedWayId);
  if (!pair) return system;
  const { keeper, other, sameDirection, backwardProfile, forwardProfile } = pair;
  const median = getComponent(system.medians, namedWayId);
  const combined = combineProfiles(
    backwardProfile,
    forwardProfile,
    median?.widthM,
    median?.kindId,
    system.drivingSide,
  );
  const combinedKeeper = { ...keeper, profile: combined };
  const endpointMetadata = remapWayEndpointMetadata(
    system,
    [carriagewayEndpointRemap(other, combinedKeeper, sameDirection)],
    new Map([[other.id, keeper.id]]),
  );
  const keeperPath = resolveWayPath(keeper);
  const stations = system.stations.map((station) => {
    if (!anchorOnWayId(station, other.id)) return station;
    const nearest = nearestOnPath(keeperPath, station.coord);
    return nearest
      ? {
          ...station,
          anchors: replacedStationAnchors(station, other.id, {
            wayId: keeper.id,
            t: nearest.t,
          }),
        }
      : station;
  });
  const junctions = collapsedJunctions(system.ways, system.nodes, keeper, other);
  const reanchoredStations = reanchorMovedWays(
    system,
    junctions.ways,
    stations,
    junctions.movedWayIds,
  );
  const otherPath = resolveWayPath(other);
  const services = system.services.map((service) => {
    if (!patternLegs(service.path).some((leg) => leg.wayId === other.id)) return service;
    return withServicePattern(service, {
      ...service.path,
      sections: normalizeSections(
        mapSectionLegs(service.path.sections, (legs) =>
          mergeLegs(legs, keeper.id, other.id, {
            positionOf: (wayId, t) => {
              if (wayId !== other.id || otherPath.length < 2) return t;
              return nearestOnPath(keeperPath, pointAtT(otherPath, t))?.t ?? t;
            },
            reversed: (wayId) => wayId === other.id && !sameDirection,
          }),
        ),
      ),
    });
  });
  const removed = removeWayFromSystem(
    {
      ...system,
      ways: junctions.ways,
      stations: reanchoredStations,
      nodes: junctions.nodes,
      services,
      approachControls: endpointMetadata.approachControls,
      turnRestrictions: endpointMetadata.turnRestrictions,
    },
    other.id,
  );
  return {
    ...removed,
    ways: removed.ways.map((way) => (way.id === keeper.id ? { ...way, profile: combined } : way)),
  };
}

/** Updates the median component without changing identity for equal values. */
export function withMedianWidth(
  system: TransitSystem,
  namedWayId: string,
  widthM: number | undefined,
): TransitSystem {
  const current = getComponent(system.medians, namedWayId);
  if (widthM === undefined) {
    const medians = withoutComponent(system.medians, namedWayId);
    return medians === system.medians ? system : { ...system, medians };
  }
  if (current?.widthM === widthM) return system;
  const medians = withComponent(system.medians, namedWayId, {
    widthM,
    kindId: current?.kindId ?? 'median',
  });
  return { ...system, medians };
}
