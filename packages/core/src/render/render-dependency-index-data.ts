import type { NamedWay, Node, Service, Station, Stop, TransitSystem, Way } from '../model/system';
import { nearWaysForStops } from './featureMemo';
import {
  buildServiceSpanDependencies,
  namedWayLabelDependencyId,
  type ServiceSpanDependency,
} from './dependency-identities';

interface LabelDependency {
  id: string;
  namedWayId: string;
  wayId: string;
}

/** Immutable reverse lookups derived from one TransitSystem collection set.
 * The public dependency index keeps this private so callers work with domain
 * identities rather than reconstructing service spans or label ownership. */
export interface DependencyIndexData {
  ways: readonly Way[];
  nodes: readonly Node[];
  stops: readonly Stop[];
  stations: readonly Station[];
  spans: readonly ServiceSpanDependency[];
  labels: readonly LabelDependency[];
  nodesByWay: ReadonlyMap<string, readonly string[]>;
  spansByWay: ReadonlyMap<string, readonly string[]>;
  spansByService: ReadonlyMap<string, readonly string[]>;
  wayIdsByService: ReadonlyMap<string, readonly string[]>;
  stopsByWay: ReadonlyMap<string, readonly string[]>;
  labelsByWay: ReadonlyMap<string, readonly string[]>;
  labelsByNamedWay: ReadonlyMap<string, readonly string[]>;
  waysByNode: ReadonlyMap<string, readonly string[]>;
  waysByNamedWay: ReadonlyMap<string, readonly string[]>;
}

function addToListMap(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key);
  if (values) {
    if (!values.includes(value)) values.push(value);
  } else map.set(key, [value]);
}

function nodeDependencies(nodes: Node[]) {
  const nodesByWay = new Map<string, string[]>();
  const waysByNode = new Map<string, string[]>();
  for (const node of nodes) {
    for (const { wayId } of node.refs) {
      addToListMap(nodesByWay, wayId, node.id);
      addToListMap(waysByNode, node.id, wayId);
    }
  }
  return { nodesByWay, waysByNode };
}

function spanDependencies(services: Service[]) {
  const spans = buildServiceSpanDependencies(services);
  const spansByWay = new Map<string, string[]>();
  const spansByService = new Map<string, string[]>();
  const wayIdsByService = new Map<string, string[]>();
  for (const span of spans) {
    addToListMap(spansByWay, span.wayId, span.id);
    addToListMap(spansByService, span.serviceId, span.id);
    addToListMap(wayIdsByService, span.serviceId, span.wayId);
  }
  return { spans, spansByWay, spansByService, wayIdsByService };
}

function stopDependencies(stops: Stop[], ways: Way[]): Map<string, string[]> {
  const stopsByWay = new Map<string, string[]>();
  const nearbyWays = nearWaysForStops(stops, ways);
  for (let stopIndex = 0; stopIndex < stops.length; stopIndex++) {
    const stop = stops[stopIndex];
    const dependencies = new Set([
      ...nearbyWays[stopIndex],
      ...stop.anchors.map(({ wayId }) => wayId),
    ]);
    for (const wayId of dependencies) addToListMap(stopsByWay, wayId, stop.id);
  }
  return stopsByWay;
}

function labelDependencies(namedWays: NamedWay[]) {
  const labels: LabelDependency[] = [];
  const labelsByWay = new Map<string, string[]>();
  const labelsByNamedWay = new Map<string, string[]>();
  const waysByNamedWay = new Map<string, string[]>();
  for (const namedWay of namedWays) {
    for (const wayId of namedWay.wayIds) {
      const id = namedWayLabelDependencyId(namedWay.id, wayId);
      labels.push({ id, namedWayId: namedWay.id, wayId });
      addToListMap(labelsByWay, wayId, id);
      addToListMap(labelsByNamedWay, namedWay.id, id);
      addToListMap(waysByNamedWay, namedWay.id, wayId);
    }
  }
  return { labels, labelsByWay, labelsByNamedWay, waysByNamedWay };
}

export function createDependencyIndexData(system: TransitSystem): DependencyIndexData {
  const node = nodeDependencies(system.nodes);
  const span = spanDependencies(system.services);
  const label = labelDependencies(system.namedWays);
  return {
    ways: system.ways,
    nodes: system.nodes,
    stops: system.stops,
    stations: system.stations,
    ...node,
    ...span,
    ...label,
    stopsByWay: stopDependencies(system.stops, system.ways),
  };
}
