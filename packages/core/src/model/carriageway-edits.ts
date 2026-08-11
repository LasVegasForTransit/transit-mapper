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
import type { LngLat, NamedWay, Station, StationAnchor, TransitSystem, Way } from './system';
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

function reanchored(station: Station, replacedWayId: string, next: StationAnchor): StationAnchor[] {
  const kept = station.anchors.filter(
    (anchor) => anchor.wayId !== replacedWayId && anchor.wayId !== next.wayId,
  );
  return [next, ...kept];
}

function oneDirectionOnly(way: Way): boolean {
  return new Set(directionalLanes(way.profile).map((lane) => lane.direction)).size <= 1;
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

interface CarriagewayPair {
  keeper: Way;
  other: Way;
  sameDirection: boolean;
}

function carriagewayPair(system: TransitSystem, namedWayId: string): CarriagewayPair | null {
  const identity = system.namedWays.find((namedWay) => namedWay.id === namedWayId);
  if (identity?.wayIds.length !== 2) return null;
  const first = system.ways.find((way) => way.id === identity.wayIds[0]);
  const second = system.ways.find((way) => way.id === identity.wayIds[1]);
  if (!first?.points[1] || !second?.points[1]) return null;
  if (first.typeId !== second.typeId || !oneDirectionOnly(first) || !oneDirectionOnly(second)) {
    return null;
  }
  const runsForward = (way: Way) =>
    directionalLanes(way.profile).every((lane) => lane.direction === 'forward');
  const keeper = runsForward(first) ? first : runsForward(second) ? second : first;
  const other = keeper === first ? second : first;
  return { keeper, other, sameDirection: samePointDirection(keeper, other) };
}

/** Collapses a one-way pair back onto its forward carriageway. */
export function combineCarriageways(system: TransitSystem, namedWayId: string): TransitSystem {
  const pair = carriagewayPair(system, namedWayId);
  if (!pair) return system;
  const { keeper, other, sameDirection } = pair;
  const median = getComponent(system.medians, namedWayId);
  const combined = combineProfiles(
    sameDirection ? other.profile : flipProfile(other.profile),
    keeper.profile,
    median?.widthM,
    median?.kindId,
    system.drivingSide,
  );
  const keeperPath = resolveWayPath(keeper);
  const stations = system.stations.map((station) => {
    if (!anchorOnWayId(station, other.id)) return station;
    const nearest = nearestOnPath(keeperPath, station.coord);
    return nearest
      ? {
          ...station,
          anchors: reanchored(station, other.id, { wayId: keeper.id, t: nearest.t }),
        }
      : station;
  });
  const aligned = keeper.points.length === other.points.length;
  const mapIndex = (index: number) =>
    aligned ? index : nearestPointIndex(keeper.points, other.points[index]);
  const nodes = system.nodes
    .map((node) => {
      const refs = node.refs.map((ref) =>
        ref.wayId === other.id ? { wayId: keeper.id, pointIndex: mapIndex(ref.pointIndex) } : ref,
      );
      const seen = new Set<string>();
      return {
        ...node,
        refs: refs.filter((ref) => {
          const key = `${ref.wayId}:${ref.pointIndex}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      };
    })
    .filter((node) => node.refs.length >= 2);
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
  const removed = removeWayFromSystem({ ...system, stations, nodes, services }, other.id);
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
