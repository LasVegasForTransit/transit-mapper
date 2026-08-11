import type { NamedWay, Node, Service, Station, Way } from '../model/system';
import { nearWaysForStations } from './featureMemo';
import { buildServiceSpanDependencies, namedWayLabelDependencyId } from './dependency-identities';
import type { RenderDependencyClosure } from './dependency-index';

export interface MutablePreparedDependencyState {
  readonly nodeIdsByWay: Map<string, string[]>;
  readonly wayIdsByNode: Map<string, string[]>;
  readonly spansByWay: Map<string, string[]>;
  readonly spansByService: Map<string, string[]>;
  readonly serviceIdsByWay: Map<string, string[]>;
  readonly stationsByWay: Map<string, string[]>;
  readonly wayIdsByStation: Map<string, string[]>;
  readonly labelsByWay: Map<string, string[]>;
  readonly namedWayIdsByWay: Map<string, string[]>;
  readonly spanRank: Map<string, number>;
  readonly labelRank: Map<string, number>;
  nextSpanRank: number;
  nextLabelRank: number;
}

export interface PreparedDependencyState {
  readonly nodeIdsByWay: ReadonlyMap<string, readonly string[]>;
  readonly wayIdsByNode: ReadonlyMap<string, readonly string[]>;
  readonly spansByWay: ReadonlyMap<string, readonly string[]>;
  readonly spansByService: ReadonlyMap<string, readonly string[]>;
  readonly serviceIdsByWay: ReadonlyMap<string, readonly string[]>;
  readonly stationsByWay: ReadonlyMap<string, readonly string[]>;
  readonly wayIdsByStation: ReadonlyMap<string, readonly string[]>;
  readonly labelsByWay: ReadonlyMap<string, readonly string[]>;
  readonly namedWayIdsByWay: ReadonlyMap<string, readonly string[]>;
  readonly spanRank: ReadonlyMap<string, number>;
  readonly labelRank: ReadonlyMap<string, number>;
}

function addUnique(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key);
  if (!values) map.set(key, [value]);
  else if (!values.includes(value)) values.push(value);
}

export function createMutablePreparedDependencyState(): MutablePreparedDependencyState {
  return {
    nodeIdsByWay: new Map(),
    wayIdsByNode: new Map(),
    spansByWay: new Map(),
    spansByService: new Map(),
    serviceIdsByWay: new Map(),
    stationsByWay: new Map(),
    wayIdsByStation: new Map(),
    labelsByWay: new Map(),
    namedWayIdsByWay: new Map(),
    spanRank: new Map(),
    labelRank: new Map(),
    nextSpanRank: 0,
    nextLabelRank: 0,
  };
}

export function addPreparedNodes(
  state: MutablePreparedDependencyState,
  nodes: readonly Node[],
): void {
  for (const node of nodes) {
    for (const { wayId } of node.refs) {
      addUnique(state.nodeIdsByWay, wayId, node.id);
      addUnique(state.wayIdsByNode, node.id, wayId);
    }
  }
}

export function addPreparedServices(
  state: MutablePreparedDependencyState,
  services: readonly Service[],
): void {
  for (const service of services) {
    const spans = buildServiceSpanDependencies([service]);
    for (const span of spans) {
      addUnique(state.spansByWay, span.wayId, span.id);
      addUnique(state.spansByService, span.serviceId, span.id);
      addUnique(state.serviceIdsByWay, span.wayId, span.serviceId);
      if (!state.spanRank.has(span.id)) state.spanRank.set(span.id, state.nextSpanRank++);
    }
  }
}

export function addPreparedStations(
  state: MutablePreparedDependencyState,
  stations: Station[],
  ways: Way[],
): void {
  const nearby = nearWaysForStations(stations, ways);
  for (let index = 0; index < stations.length; index++) {
    const station = stations[index];
    const wayIds = new Set([...nearby[index], ...station.anchors.map(({ wayId }) => wayId)]);
    for (const wayId of wayIds) {
      addUnique(state.stationsByWay, wayId, station.id);
      addUnique(state.wayIdsByStation, station.id, wayId);
    }
  }
}

/** Adds station relationships after the preparation-owned spatial grid has
 * resolved nearby ways in a separately measured unit. */
export function addPreparedStationWayIds(
  state: MutablePreparedDependencyState,
  station: Station,
  nearbyWayIds: readonly string[],
): void {
  const wayIds = new Set([...nearbyWayIds, ...station.anchors.map(({ wayId }) => wayId)]);
  for (const wayId of wayIds) {
    addUnique(state.stationsByWay, wayId, station.id);
    addUnique(state.wayIdsByStation, station.id, wayId);
  }
}

export function addPreparedNamedWays(
  state: MutablePreparedDependencyState,
  namedWays: readonly NamedWay[],
): void {
  for (const namedWay of namedWays) {
    for (const wayId of namedWay.wayIds) {
      const labelId = namedWayLabelDependencyId(namedWay.id, wayId);
      addUnique(state.labelsByWay, wayId, labelId);
      addUnique(state.namedWayIdsByWay, wayId, namedWay.id);
      if (!state.labelRank.has(labelId)) state.labelRank.set(labelId, state.nextLabelRank++);
    }
  }
}

function ordered(values: ReadonlySet<string>, rank: ReadonlyMap<string, number>): string[] {
  return [...values].sort(
    (left, right) =>
      (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right),
  );
}

function addAll(target: Set<string>, values: readonly string[] | undefined): void {
  if (values) for (const value of values) target.add(value);
}

export interface PreparedClosureOrder {
  readonly wayRank: ReadonlyMap<string, number>;
  readonly nodeRank: ReadonlyMap<string, number>;
  readonly stationRank: ReadonlyMap<string, number>;
}

export function preparedWayClosure(
  state: PreparedDependencyState,
  changedWayIds: readonly string[],
  order: PreparedClosureOrder,
): RenderDependencyClosure {
  const corridors = new Set<string>();
  const junctions = new Set<string>();
  const spans = new Set<string>();
  const stations = new Set<string>();
  const labels = new Set<string>();
  for (const wayId of changedWayIds) {
    corridors.add(wayId);
    const nodeIds = state.nodeIdsByWay.get(wayId) ?? [];
    addAll(junctions, nodeIds);
    addAll(spans, state.spansByWay.get(wayId));
    addAll(stations, state.stationsByWay.get(wayId));
    addAll(labels, state.labelsByWay.get(wayId));
    for (const nodeId of nodeIds) {
      for (const armWayId of state.wayIdsByNode.get(nodeId) ?? []) {
        corridors.add(armWayId);
        addAll(spans, state.spansByWay.get(armWayId));
      }
    }
  }
  return {
    corridorIds: ordered(corridors, order.wayRank),
    junctionIds: ordered(junctions, order.nodeRank),
    connectorJunctionIds: ordered(junctions, order.nodeRank),
    serviceSpanIds: ordered(spans, state.spanRank),
    stationIds: ordered(stations, order.stationRank),
    labelIds: ordered(labels, state.labelRank),
  };
}

export function emptyPreparedClosure(): RenderDependencyClosure {
  return {
    corridorIds: [],
    junctionIds: [],
    connectorJunctionIds: [],
    serviceSpanIds: [],
    stationIds: [],
    labelIds: [],
  };
}

export function mergePreparedClosures(
  previous: RenderDependencyClosure,
  next: RenderDependencyClosure,
): RenderDependencyClosure {
  const merge = (left: readonly string[], right: readonly string[]) => [
    ...new Set([...left, ...right]),
  ];
  return {
    corridorIds: merge(previous.corridorIds, next.corridorIds),
    junctionIds: merge(previous.junctionIds, next.junctionIds),
    connectorJunctionIds: merge(previous.connectorJunctionIds, next.connectorJunctionIds),
    serviceSpanIds: merge(previous.serviceSpanIds, next.serviceSpanIds),
    stationIds: merge(previous.stationIds, next.stationIds),
    labelIds: merge(previous.labelIds, next.labelIds),
  };
}

export function servicesByWayFromDependencies(
  state: PreparedDependencyState,
  servicesById: ReadonlyMap<string, Service>,
): ReadonlyMap<string, readonly Service[]> {
  return new Map(
    [...state.serviceIdsByWay].map(([wayId, serviceIds]) => [
      wayId,
      serviceIds.flatMap((serviceId) => {
        const service = servicesById.get(serviceId);
        return service ? [service] : [];
      }),
    ]),
  );
}
