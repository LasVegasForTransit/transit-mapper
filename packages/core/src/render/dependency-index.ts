import type { NamedWay, Node, Service, Station, Stop, TransitSystem, Way } from '../model/system';
import {
  createDependencyIndexData,
  type DependencyIndexData,
} from './render-dependency-index-data';
import {
  createRenderIndexCacheDiagnosticCounter,
  type RenderIndexCacheDiagnostics,
} from './render-cache-diagnostics';

export {
  namedWayLabelDependencyId,
  serviceSpanDependencyId,
  type ServiceSpanBranch,
  type ServiceSpanDependencyIdentity,
} from './dependency-identities';

export interface RenderDependencyChanges {
  wayIds?: readonly string[];
  nodeIds?: readonly string[];
  serviceIds?: readonly string[];
  stopIds?: readonly string[];
  stationIds?: readonly string[];
  namedWayIds?: readonly string[];
  turnRestrictionKeys?: readonly string[];
  approachControlKeys?: readonly string[];
  medianKeys?: readonly string[];
}

/** Domain-stage identities, resolved to GeoJSON feature IDs by scene projection. */
export interface RenderDependencyClosure {
  corridorIds: readonly string[];
  junctionIds: readonly string[];
  connectorJunctionIds: readonly string[];
  serviceSpanIds: readonly string[];
  stopIds: readonly string[];
  stationIds: readonly string[];
  labelIds: readonly string[];
}

/** Opaque immutable reverse-topology index. */
export interface RenderDependencyIndex {
  readonly kind: 'render-dependency-index';
}

/** Process-local evidence for immutable reverse-topology reuse. Resetting the
 * counters does not clear cached dependency indexes. */
export type DependencyIndexCacheDiagnostics = RenderIndexCacheDiagnostics;

export interface RenderDependencyProjectionCandidates {
  serviceWayIds: readonly string[];
  serviceIds: readonly string[];
  serviceNodeIds: readonly string[];
  labelWayIds: readonly string[];
  namedWayIds: readonly string[];
}

type NamedWayDependencyCache = WeakMap<NamedWay[], RenderDependencyIndex>;
type StationDependencyCache = WeakMap<Station[], NamedWayDependencyCache>;
type StopDependencyCache = WeakMap<Stop[], StationDependencyCache>;
type NodeDependencyCache = WeakMap<Node[], StopDependencyCache>;
type ServiceDependencyCache = WeakMap<Service[], NodeDependencyCache>;

const dependencyData = new WeakMap<RenderDependencyIndex, DependencyIndexData>();
const dependencyCache = new WeakMap<Way[], ServiceDependencyCache>();
const dependencyIndexDiagnostics = createRenderIndexCacheDiagnosticCounter();
export const snapshotDependencyIndexCacheDiagnostics = dependencyIndexDiagnostics.snapshot;

/** Resets observation only so a warmed immutable snapshot stays cached. */
export const resetDependencyIndexCacheDiagnostics = dependencyIndexDiagnostics.reset;

function createDependencyIndex(system: TransitSystem): RenderDependencyIndex {
  const index = Object.freeze({ kind: 'render-dependency-index' as const });
  dependencyData.set(index, createDependencyIndexData(system));
  dependencyIndexDiagnostics.recordBuild();
  return index;
}

/** Cached by the immutable collection identities that define render topology. */
export function renderDependencyIndexFor(system: TransitSystem): RenderDependencyIndex {
  let byService = dependencyCache.get(system.ways);
  if (!byService) dependencyCache.set(system.ways, (byService = new WeakMap()));
  let byNode = byService.get(system.services);
  if (!byNode) byService.set(system.services, (byNode = new WeakMap()));
  let byStop = byNode.get(system.nodes);
  if (!byStop) byNode.set(system.nodes, (byStop = new WeakMap()));
  let byStation = byStop.get(system.stops);
  if (!byStation) byStop.set(system.stops, (byStation = new WeakMap()));
  let byNamedWay = byStation.get(system.stations);
  if (!byNamedWay) byStation.set(system.stations, (byNamedWay = new WeakMap()));
  const cached = byNamedWay.get(system.namedWays);
  if (cached) {
    dependencyIndexDiagnostics.recordCacheHit();
    return cached;
  }
  const index = createDependencyIndex(system);
  byNamedWay.set(system.namedWays, index);
  return index;
}

function addAll(target: Set<string>, values: readonly string[] | undefined): void {
  if (values) for (const value of values) target.add(value);
}

function wayIdFromComponentKey(data: DependencyIndexData, key: string): string | undefined {
  // Model component keys are `${wayId}:${subpart}`. Matching live ids avoids
  // assuming way ids themselves contain no colons; longest wins for prefixes.
  let matched: string | undefined;
  for (const way of data.ways) {
    if (key.startsWith(`${way.id}:`) && (!matched || way.id.length > matched.length)) {
      matched = way.id;
    }
  }
  return matched;
}

function orderedMembers(order: readonly string[], members: ReadonlySet<string>): readonly string[] {
  return order.filter((id) => members.has(id));
}

interface MutableDependencyClosure {
  corridors: Set<string>;
  junctions: Set<string>;
  connectorJunctions: Set<string>;
  spans: Set<string>;
  stops: Set<string>;
  stations: Set<string>;
  labels: Set<string>;
}

function mutableClosure(): MutableDependencyClosure {
  return {
    corridors: new Set(),
    junctions: new Set(),
    connectorJunctions: new Set(),
    spans: new Set(),
    stops: new Set(),
    stations: new Set(),
    labels: new Set(),
  };
}

function includeWay(
  data: DependencyIndexData,
  closure: MutableDependencyClosure,
  wayId: string,
  physical: boolean,
): void {
  if (physical) closure.corridors.add(wayId);
  const nodes = data.nodesByWay.get(wayId) ?? [];
  addAll(closure.junctions, nodes);
  addAll(closure.connectorJunctions, nodes);
  addAll(closure.spans, data.spansByWay.get(wayId));
  addAll(closure.stops, data.stopsByWay.get(wayId));
  addAll(closure.labels, data.labelsByWay.get(wayId));
  if (!physical) return;

  // Street geometry is trimmed against the complete junction footprint. A
  // changed arm therefore changes every other arm at its adjacent junctions,
  // but nothing beyond those junctions. Deliberately add one hop without
  // recursing through the network or inheriting the neighbouring arm's labels
  // and stops.
  for (const nodeId of nodes) {
    for (const armWayId of data.waysByNode.get(nodeId) ?? []) {
      closure.corridors.add(armWayId);
      addAll(closure.spans, data.spansByWay.get(armWayId));
    }
  }
}

function includeNode(
  data: DependencyIndexData,
  closure: MutableDependencyClosure,
  nodeId: string,
): void {
  closure.junctions.add(nodeId);
  closure.connectorJunctions.add(nodeId);
  for (const wayId of data.waysByNode.get(nodeId) ?? []) {
    closure.corridors.add(wayId);
    addAll(closure.spans, data.spansByWay.get(wayId));
  }
}

function includeService(
  data: DependencyIndexData,
  closure: MutableDependencyClosure,
  serviceId: string,
): void {
  addAll(closure.spans, data.spansByService.get(serviceId));
  for (const wayId of data.wayIdsByService.get(serviceId) ?? []) {
    addAll(closure.stops, data.stopsByWay.get(wayId));
  }
}

function includeComponent(
  data: DependencyIndexData,
  closure: MutableDependencyClosure,
  key: string,
): void {
  const wayId = wayIdFromComponentKey(data, key);
  if (!wayId) return;
  addAll(closure.connectorJunctions, data.nodesByWay.get(wayId));
  addAll(closure.junctions, data.nodesByWay.get(wayId));
  addAll(closure.spans, data.spansByWay.get(wayId));
}

function finalizedClosure(
  data: DependencyIndexData,
  closure: MutableDependencyClosure,
): RenderDependencyClosure {
  return {
    corridorIds: orderedMembers(
      data.ways.map(({ id }) => id),
      closure.corridors,
    ),
    junctionIds: orderedMembers(
      data.nodes.map(({ id }) => id),
      closure.junctions,
    ),
    connectorJunctionIds: orderedMembers(
      data.nodes.map(({ id }) => id),
      closure.connectorJunctions,
    ),
    serviceSpanIds: orderedMembers(
      data.spans.map(({ id }) => id),
      closure.spans,
    ),
    stopIds: orderedMembers(
      data.stops.map(({ id }) => id),
      closure.stops,
    ),
    stationIds: orderedMembers(
      data.stations.map(({ id }) => id),
      closure.stations,
    ),
    labelIds: orderedMembers(
      data.labels.map(({ id }) => id),
      closure.labels,
    ),
  };
}

/** Resolve only the render-domain closure touched by the supplied entity edits. */
function includeChangedWays(
  data: DependencyIndexData,
  closure: MutableDependencyClosure,
  ids: readonly string[] | undefined,
): void {
  for (const id of ids ?? []) includeWay(data, closure, id, true);
}

function includeChangedNodes(
  data: DependencyIndexData,
  closure: MutableDependencyClosure,
  ids: readonly string[] | undefined,
): void {
  for (const id of ids ?? []) includeNode(data, closure, id);
}

function includeChangedServices(
  data: DependencyIndexData,
  closure: MutableDependencyClosure,
  ids: readonly string[] | undefined,
): void {
  for (const id of ids ?? []) includeService(data, closure, id);
}

function includeChangedNamedWays(
  data: DependencyIndexData,
  closure: MutableDependencyClosure,
  ids: readonly string[] | undefined,
): void {
  for (const id of ids ?? []) addAll(closure.labels, data.labelsByNamedWay.get(id));
}

function includeChangedMedians(
  data: DependencyIndexData,
  closure: MutableDependencyClosure,
  ids: readonly string[] | undefined,
): void {
  for (const id of ids ?? []) {
    for (const wayId of data.waysByNamedWay.get(id) ?? []) includeWay(data, closure, wayId, true);
  }
}

function includeChangedComponents(
  data: DependencyIndexData,
  closure: MutableDependencyClosure,
  keys: readonly string[] | undefined,
): void {
  for (const key of keys ?? []) includeComponent(data, closure, key);
}

export function dependencyClosure(
  index: RenderDependencyIndex,
  changes: RenderDependencyChanges,
): RenderDependencyClosure {
  const data = dependencyData.get(index);
  if (!data) throw new Error('Unknown renderer dependency index');
  const closure = mutableClosure();
  includeChangedWays(data, closure, changes.wayIds);
  includeChangedNodes(data, closure, changes.nodeIds);
  includeChangedServices(data, closure, changes.serviceIds);
  addAll(closure.stops, changes.stopIds);
  addAll(closure.stations, changes.stationIds);
  includeChangedNamedWays(data, closure, changes.namedWayIds);
  includeChangedMedians(data, closure, changes.medianKeys);
  includeChangedComponents(data, closure, changes.turnRestrictionKeys);
  includeChangedComponents(data, closure, changes.approachControlKeys);
  return finalizedClosure(data, closure);
}

/** Map an invalidated domain closure back to the concrete entities projection
 * must visit. The dependency index stays opaque; callers never parse encoded
 * service-span or label IDs to rediscover their owners. */
export function projectionCandidatesForDependencyClosure(
  index: RenderDependencyIndex,
  closure: RenderDependencyClosure,
): RenderDependencyProjectionCandidates {
  const data = dependencyData.get(index);
  if (!data) throw new Error('Unknown renderer dependency index');
  const spanIds = new Set(closure.serviceSpanIds);
  const labelIds = new Set(closure.labelIds);
  const serviceWayIds = new Set<string>();
  const serviceIds = new Set<string>();
  const serviceNodeIds = new Set<string>();
  const labelWayIds = new Set<string>();
  const namedWayIds = new Set<string>();
  for (const span of data.spans) {
    if (!spanIds.has(span.id)) continue;
    serviceWayIds.add(span.wayId);
    serviceIds.add(span.serviceId);
  }
  for (const label of data.labels) {
    if (!labelIds.has(label.id)) continue;
    labelWayIds.add(label.wayId);
    namedWayIds.add(label.namedWayId);
  }
  for (const wayId of serviceWayIds) addAll(serviceNodeIds, data.nodesByWay.get(wayId));
  return {
    serviceWayIds: [...serviceWayIds],
    serviceIds: [...serviceIds],
    serviceNodeIds: [...serviceNodeIds],
    labelWayIds: [...labelWayIds],
    namedWayIds: [...namedWayIds],
  };
}
