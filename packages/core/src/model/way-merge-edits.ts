import {
  anchorOnWayId,
  haversineMeters,
  nearestOnPath,
  patternLegs,
  pointAtT,
  resolveWayPath,
} from './geo';
import { prunedToLiveLanes, withoutComponent } from './components';
import { mapSectionLegs, mergeLegs, normalizeSections } from './patternEdits';
import { flipProfile } from './profile';
import { withServicePattern } from './line-service';
import { removeGroupMembers } from './system/group';
import { replacedStationAnchors } from './station-reanchoring';
import type {
  LaneConnector,
  LngLat,
  NamedWay,
  Node,
  PatternLeg,
  TransitSystem,
  Way,
} from './system';
import {
  remapWayEndpointMetadata,
  type WayEndpoint,
  type WayEndpointRemap,
} from './way-endpoint-metadata';

const JOIN_TOLERANCE_M = 0.75;

interface PointMerge {
  points: LngLat[];
  secondBeforeFirst: boolean;
  reversedSecond: boolean;
  mapFirst(index: number): number;
  mapSecond(index: number): number;
}

type JoinCandidate = readonly [
  distance: number,
  secondBeforeFirst: boolean,
  reversedSecond: boolean,
];

function mergedPoints(first: Way, second: Way): PointMerge | null {
  const firstLength = first.points.length;
  const secondLength = second.points.length;
  const firstStart = first.points[0];
  const firstEnd = first.points[firstLength - 1];
  const secondStart = second.points[0];
  const secondEnd = second.points[secondLength - 1];
  const [distance, secondBeforeFirst, reversedSecond] = (
    [
      [haversineMeters(firstEnd, secondStart), false, false],
      [haversineMeters(firstEnd, secondEnd), false, true],
      [haversineMeters(firstStart, secondEnd), true, false],
      [haversineMeters(firstStart, secondStart), true, true],
    ] satisfies JoinCandidate[]
  ).sort((left, right) => left[0] - right[0])[0];
  if (distance > JOIN_TOLERANCE_M) return null;
  const alignedSecond = reversedSecond ? [...second.points].reverse() : second.points;
  const before = secondBeforeFirst ? alignedSecond : first.points;
  const after = secondBeforeFirst ? first.points : alignedSecond;
  return {
    points: [...before, ...after.slice(1)],
    secondBeforeFirst,
    reversedSecond,
    mapFirst: (index) => (secondBeforeFirst ? secondLength - 1 + index : index),
    mapSecond: (index) => {
      const alignedIndex = reversedSecond ? secondLength - 1 - index : index;
      return secondBeforeFirst ? alignedIndex : firstLength - 1 + alignedIndex;
    },
  };
}

function compatibleSecondLaneIds(
  first: Way,
  second: Way,
  reversedSecond: boolean,
): Map<string, string> | null {
  const alignedSecond = reversedSecond ? flipProfile(second.profile) : second.profile;
  if (first.profile.lanes.length !== alignedSecond.lanes.length) return null;
  const laneIds = new Map<string, string>();
  for (const [index, lane] of alignedSecond.lanes.entries()) {
    const destination = first.profile.lanes[index];
    if (
      destination.kindId !== lane.kindId ||
      destination.widthM !== lane.widthM ||
      destination.direction !== lane.direction
    ) {
      return null;
    }
    laneIds.set(lane.id, destination.id);
  }
  return laneIds;
}

function remappedConnectorEnd(
  end: LaneConnector['from'],
  keepId: string,
  otherId: string,
  secondLaneIds: ReadonlyMap<string, string>,
): LaneConnector['from'] | null {
  if (end.wayId !== otherId) return end;
  const laneId = secondLaneIds.get(end.laneId);
  return laneId ? { wayId: keepId, laneId } : null;
}

interface MergedNodesOptions {
  keepId: string;
  otherId: string;
  merge: PointMerge;
  secondLaneIds: ReadonlyMap<string, string>;
}

function mergedNodes(nodes: Node[], options: MergedNodesOptions): Node[] {
  const { keepId, otherId, merge, secondLaneIds } = options;
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
    const connectors = node.connectors?.flatMap((connector) => {
      const from = remappedConnectorEnd(connector.from, keepId, otherId, secondLaneIds);
      const to = remappedConnectorEnd(connector.to, keepId, otherId, secondLaneIds);
      if (!from || !to) return [];
      return [from === connector.from && to === connector.to ? connector : { from, to }];
    });
    return [
      {
        ...node,
        refs: deduped,
        connectors: connectors && connectors.length > 0 ? connectors : undefined,
      },
    ];
  });
}

interface MergedEndpointOptions {
  first: Way;
  second: Way;
  merged: Way;
  merge: PointMerge;
  secondLaneIds: ReadonlyMap<string, string>;
}

function outerEndpointRemap(
  source: Way,
  destination: Way,
  sourceEnd: WayEndpoint['end'],
  destinationEnd: WayEndpoint['end'],
): WayEndpointRemap {
  const endpoint = { way: destination, end: destinationEnd };
  return {
    source,
    start: sourceEnd === 'start' ? endpoint : null,
    end: sourceEnd === 'end' ? endpoint : null,
  };
}

function mergedEndpointRemaps(options: MergedEndpointOptions): WayEndpointRemap[] {
  const { first, second, merged, merge, secondLaneIds } = options;
  const firstEnd = merge.secondBeforeFirst ? 'end' : 'start';
  const secondDestinationEnd = merge.secondBeforeFirst ? 'start' : 'end';
  const secondSourceEnd = merge.reversedSecond
    ? secondDestinationEnd === 'start'
      ? 'end'
      : 'start'
    : secondDestinationEnd;
  return [
    outerEndpointRemap(first, merged, firstEnd, firstEnd),
    {
      ...outerEndpointRemap(second, merged, secondSourceEnd, secondDestinationEnd),
      laneIds: secondLaneIds,
    },
  ];
}

interface MergedNamedWays {
  namedWays: NamedWay[];
  removedIds: Set<string>;
}

function mergedNamedWays(namedWays: NamedWay[], otherId: string): MergedNamedWays {
  let changed = false;
  const removedIds = new Set<string>();
  const remaining: NamedWay[] = [];
  for (const namedWay of namedWays) {
    if (!namedWay.wayIds.includes(otherId)) {
      remaining.push(namedWay);
      continue;
    }
    changed = true;
    const wayIds = namedWay.wayIds.filter((wayId) => wayId !== otherId);
    if (wayIds.length > 0) remaining.push({ ...namedWay, wayIds });
    else removedIds.add(namedWay.id);
  }
  return { namedWays: changed ? remaining : namedWays, removedIds };
}

interface MergeServicesOptions {
  first: Way;
  second: Way;
  mergedWay: Way;
  merge: PointMerge;
  secondLaneIds: ReadonlyMap<string, string>;
}

function remapPinnedLanes(
  legs: PatternLeg[],
  secondId: string,
  secondLaneIds: ReadonlyMap<string, string>,
): PatternLeg[] {
  return legs.map((leg) => {
    if (leg.wayId !== secondId || leg.lane.kind !== 'pinned') return leg;
    const laneId = secondLaneIds.get(leg.lane.laneId);
    return laneId && laneId !== leg.lane.laneId
      ? { ...leg, lane: { kind: 'pinned', laneId } }
      : leg;
  });
}

function mergedServices(
  services: TransitSystem['services'],
  options: MergeServicesOptions,
): TransitSystem['services'] {
  const { first, second, mergedWay, merge, secondLaneIds } = options;
  const mergedPath = resolveWayPath(mergedWay);
  const oldPaths = new Map([
    [first.id, resolveWayPath(first)],
    [second.id, resolveWayPath(second)],
  ]);
  return services.map((service) => {
    const pattern = service.path;
    if (!patternLegs(pattern).some((leg) => leg.wayId === first.id || leg.wayId === second.id)) {
      return service;
    }
    return withServicePattern(service, {
      ...pattern,
      sections: normalizeSections(
        mapSectionLegs(pattern.sections, (legs) =>
          mergeLegs(remapPinnedLanes(legs, second.id, secondLaneIds), first.id, second.id, {
            positionOf: (wayId, t) => {
              const oldPath = oldPaths.get(wayId);
              if (!oldPath || oldPath.length < 2) return t;
              return nearestOnPath(mergedPath, pointAtT(oldPath, t))?.t ?? t;
            },
            reversed: (wayId) => wayId === second.id && merge.reversedSecond,
          }),
        ),
      ),
    });
  });
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
  const secondLaneIds = compatibleSecondLaneIds(first, second, merge.reversedSecond);
  if (!secondLaneIds) return system;
  const mergedWay: Way = { ...first, points: merge.points };
  const ways = system.ways
    .filter((way) => way.id !== otherId)
    .map((way) => (way.id === keepId ? mergedWay : way));
  const nodes = mergedNodes(system.nodes, { keepId, otherId, merge, secondLaneIds });
  const mergedPath = resolveWayPath(mergedWay);
  const services = mergedServices(system.services, {
    first,
    second,
    mergedWay,
    merge,
    secondLaneIds,
  });
  const stations = system.stations.map((station) => {
    if (!anchorOnWayId(station, keepId) && !anchorOnWayId(station, otherId)) return station;
    const nearest = nearestOnPath(mergedPath, station.coord);
    return nearest
      ? {
          ...station,
          anchors: replacedStationAnchors(station, otherId, { wayId: keepId, t: nearest.t }),
        }
      : station;
  });
  const named = mergedNamedWays(system.namedWays, otherId);
  let medians = system.medians;
  for (const id of named.removedIds) medians = withoutComponent(medians, id);
  const endpointMetadata = remapWayEndpointMetadata(
    system,
    mergedEndpointRemaps({
      first,
      second,
      merged: mergedWay,
      merge,
      secondLaneIds,
    }),
    new Map([[otherId, keepId]]),
  );
  const next: TransitSystem = {
    ...system,
    ways,
    nodes,
    services,
    stations,
    namedWays: named.namedWays,
    medians,
    approachControls: endpointMetadata.approachControls,
    turnRestrictions: prunedToLiveLanes(endpointMetadata.turnRestrictions, ways),
  };
  return removeGroupMembers(next, new Set([otherId, ...named.removedIds]));
}
