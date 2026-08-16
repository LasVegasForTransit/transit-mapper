import type { Facility, Group, NamedWay, Node, Service, Station, Stop } from '../model/system';
import {
  createRenderIndexCacheDiagnosticCounter,
  type RenderIndexCacheDiagnostics,
} from './render-cache-diagnostics';

const nodesByIdCache = new WeakMap<Node[], ReadonlyMap<string, Node>>();
const stopsByIdCache = new WeakMap<Stop[], ReadonlyMap<string, Stop>>();
const stationsByIdCache = new WeakMap<Station[], ReadonlyMap<string, Station>>();
const namedWaysByIdCache = new WeakMap<NamedWay[], ReadonlyMap<string, NamedWay>>();
const facilitiesByIdCache = new WeakMap<Facility[], ReadonlyMap<string, Facility>>();
const groupsByIdCache = new WeakMap<Group[], ReadonlyMap<string, Group>>();
const servicesByIdCache = new WeakMap<Service[], ReadonlyMap<string, Service>>();

export type RenderDomainIndexKindDiagnostics = RenderIndexCacheDiagnostics;

/** Diagnostics stay separate by collection because one entity edit can
 * replace `ways` while retaining node, station, and label identities. */
export interface RenderDomainIndexCacheDiagnostics {
  readonly nodes: RenderDomainIndexKindDiagnostics;
  readonly stops: RenderDomainIndexKindDiagnostics;
  readonly stations: RenderDomainIndexKindDiagnostics;
  readonly namedWays: RenderDomainIndexKindDiagnostics;
  readonly facilities: RenderDomainIndexKindDiagnostics;
  readonly groups: RenderDomainIndexKindDiagnostics;
  readonly services: RenderDomainIndexKindDiagnostics;
}

const domainIndexDiagnostics = {
  nodes: createRenderIndexCacheDiagnosticCounter(),
  stops: createRenderIndexCacheDiagnosticCounter(),
  stations: createRenderIndexCacheDiagnosticCounter(),
  namedWays: createRenderIndexCacheDiagnosticCounter(),
  facilities: createRenderIndexCacheDiagnosticCounter(),
  groups: createRenderIndexCacheDiagnosticCounter(),
  services: createRenderIndexCacheDiagnosticCounter(),
};

export function snapshotRenderDomainIndexCacheDiagnostics(): RenderDomainIndexCacheDiagnostics {
  return {
    nodes: domainIndexDiagnostics.nodes.snapshot(),
    stops: domainIndexDiagnostics.stops.snapshot(),
    stations: domainIndexDiagnostics.stations.snapshot(),
    namedWays: domainIndexDiagnostics.namedWays.snapshot(),
    facilities: domainIndexDiagnostics.facilities.snapshot(),
    groups: domainIndexDiagnostics.groups.snapshot(),
    services: domainIndexDiagnostics.services.snapshot(),
  };
}

/** Resets observation only; the immutable collection caches remain warm. */
export function resetRenderDomainIndexCacheDiagnostics(): void {
  for (const diagnostics of Object.values(domainIndexDiagnostics)) diagnostics.reset();
}

/** Immutable collection identity is the cache key, matching the renderer's
 * topology and viewport indexes. Camera changes therefore resolve visible IDs
 * without rescanning the document. */
export function renderNodesById(nodes: Node[]): ReadonlyMap<string, Node> {
  const cached = nodesByIdCache.get(nodes);
  if (cached) {
    domainIndexDiagnostics.nodes.recordCacheHit();
    return cached;
  }
  const index = new Map(nodes.map((node) => [node.id, node] as const));
  nodesByIdCache.set(nodes, index);
  domainIndexDiagnostics.nodes.recordBuild();
  return index;
}

export function renderStopsById(stops: Stop[]): ReadonlyMap<string, Stop> {
  const cached = stopsByIdCache.get(stops);
  if (cached) {
    domainIndexDiagnostics.stops.recordCacheHit();
    return cached;
  }
  const index = new Map(stops.map((stop) => [stop.id, stop] as const));
  stopsByIdCache.set(stops, index);
  domainIndexDiagnostics.stops.recordBuild();
  return index;
}

export function renderStationsById(stations: Station[]): ReadonlyMap<string, Station> {
  const cached = stationsByIdCache.get(stations);
  if (cached) {
    domainIndexDiagnostics.stations.recordCacheHit();
    return cached;
  }
  const index = new Map(stations.map((station) => [station.id, station] as const));
  stationsByIdCache.set(stations, index);
  domainIndexDiagnostics.stations.recordBuild();
  return index;
}

export function renderNamedWaysById(namedWays: NamedWay[]): ReadonlyMap<string, NamedWay> {
  const cached = namedWaysByIdCache.get(namedWays);
  if (cached) {
    domainIndexDiagnostics.namedWays.recordCacheHit();
    return cached;
  }
  const index = new Map(namedWays.map((namedWay) => [namedWay.id, namedWay] as const));
  namedWaysByIdCache.set(namedWays, index);
  domainIndexDiagnostics.namedWays.recordBuild();
  return index;
}

export function renderFacilitiesById(facilities: Facility[]): ReadonlyMap<string, Facility> {
  const cached = facilitiesByIdCache.get(facilities);
  if (cached) {
    domainIndexDiagnostics.facilities.recordCacheHit();
    return cached;
  }
  const index = new Map(facilities.map((facility) => [facility.id, facility] as const));
  facilitiesByIdCache.set(facilities, index);
  domainIndexDiagnostics.facilities.recordBuild();
  return index;
}

export function renderGroupsById(groups: Group[]): ReadonlyMap<string, Group> {
  const cached = groupsByIdCache.get(groups);
  if (cached) {
    domainIndexDiagnostics.groups.recordCacheHit();
    return cached;
  }
  const index = new Map(groups.map((group) => [group.id, group] as const));
  groupsByIdCache.set(groups, index);
  domainIndexDiagnostics.groups.recordBuild();
  return index;
}

export function renderServicesById(services: Service[]): ReadonlyMap<string, Service> {
  const cached = servicesByIdCache.get(services);
  if (cached) {
    domainIndexDiagnostics.services.recordCacheHit();
    return cached;
  }
  const index = new Map(services.map((service) => [service.id, service] as const));
  servicesByIdCache.set(services, index);
  domainIndexDiagnostics.services.recordBuild();
  return index;
}

export function orderedIndexedValues<T>(
  allValues: readonly T[],
  valuesById: ReadonlyMap<string, T>,
  orderedIds: readonly string[] | undefined,
): T[] {
  if (!orderedIds) return [...allValues];
  return orderedIds.flatMap((id) => {
    const value = valuesById.get(id);
    return value ? [value] : [];
  });
}
