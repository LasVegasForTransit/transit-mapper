import type { Stop, Station, TransitSystem, Way } from '../../model/system';
import type { NetworkQuery } from '../query';
import type {
  ResolvedCarrierFragment,
  ResolvedNetworkChunk,
  ResolvedPatternLegFragment,
  ResolvedTopologyWindow,
} from '../resolved-network-chunk';
import { pointInBounds, validCoordinate } from './bounds';
import { clippedCarrierPieces } from './carrier-geometry';
import { topologyFragment, type TransferredLegFragment } from './carrier-transfer';
import { legacyDerivedId } from './identity';
import { mapInfrastructure } from './infrastructure';
import type { DerivedCall } from './patterns';
import { selectNetwork, type NetworkSelection } from './selection';
import { addNearestBoundingCalls, deriveWindows } from './topology';

interface TopologyClosure {
  calls: Map<string, DerivedCall>;
  fragments: ResolvedPatternLegFragment[];
  windows: ResolvedTopologyWindow[];
  carriers: ResolvedCarrierFragment[];
  wayIds: Set<string>;
  visibleFragmentIds: Set<string>;
}

interface MutableTopologyClosure {
  calls: Map<string, DerivedCall>;
  fragments: Map<string, ResolvedPatternLegFragment>;
  windows: ResolvedTopologyWindow[];
  carriers: Map<string, ResolvedCarrierFragment>;
  wayIds: Set<string>;
  visibleFragmentIds: Set<string>;
}

interface PlaceClosure {
  stops: Stop[];
  stopIds: Set<string>;
  stations: Station[];
  stationIds: Set<string>;
}

function addTransferredFragment(
  fragments: Map<string, ResolvedPatternLegFragment>,
  carriers: Map<string, ResolvedCarrierFragment>,
  transferred: TransferredLegFragment,
): void {
  fragments.set(transferred.fragment.id, transferred.fragment);
  carriers.set(transferred.carrier.id, transferred.carrier);
}

function addPhysicalCarriers(
  system: TransitSystem,
  query: NetworkQuery,
  wayIds: ReadonlySet<string>,
  carriers: Map<string, ResolvedCarrierFragment>,
): void {
  for (const way of system.ways) {
    if (!wayIds.has(way.id)) continue;
    for (const piece of clippedCarrierPieces(way, undefined, [0, 1], query.bounds)) {
      carriers.set(piece.carrier.id, piece.carrier);
    }
  }
}

function addVisibleFragments(selection: NetworkSelection, topology: MutableTopologyClosure): void {
  for (const transferred of selection.visibleFragments) {
    addTransferredFragment(topology.fragments, topology.carriers, transferred);
    topology.visibleFragmentIds.add(transferred.fragment.id);
    topology.wayIds.add(transferred.source.way.id);
  }
}

function addSemanticCarrierClosure(
  selection: NetworkSelection,
  topology: MutableTopologyClosure,
): void {
  for (const pattern of selection.patterns) {
    for (const fragment of pattern.fragments) {
      if (!selection.semanticCarrierClosureFragmentIds.has(fragment.id)) continue;
      const transferred = topologyFragment(fragment);
      if (transferred === undefined) continue;
      addTransferredFragment(topology.fragments, topology.carriers, transferred);
      topology.wayIds.add(fragment.way.id);
    }
  }
}

function addTopologyWindows(selection: NetworkSelection, topology: MutableTopologyClosure): void {
  for (const pattern of selection.patterns) {
    const visible = pattern.fragments.filter((fragment) =>
      selection.visibleSemanticFragmentIds.has(fragment.id),
    );
    addNearestBoundingCalls(topology.calls, pattern, visible);
    for (const derived of deriveWindows(pattern, selection.visibleSemanticFragmentIds)) {
      const transferred = derived.fragments.map(topologyFragment);
      if (transferred.some((fragment) => fragment === undefined)) continue;
      const complete = transferred as TransferredLegFragment[];
      const ids = complete.map(({ fragment }) => fragment.id);
      topology.windows.push({
        ...derived.window,
        patternLegFragmentIds: [ids[0], ...ids.slice(1)],
      });
      for (const call of derived.calls) topology.calls.set(call.id, call);
      for (const fragment of complete) {
        addTransferredFragment(topology.fragments, topology.carriers, fragment);
        topology.wayIds.add(fragment.source.way.id);
      }
    }
  }
}

function topologyClosure(
  system: TransitSystem,
  query: NetworkQuery,
  selection: NetworkSelection,
): TopologyClosure {
  const topology: MutableTopologyClosure = {
    calls: new Map(),
    fragments: new Map(),
    windows: [],
    carriers: new Map(),
    wayIds: new Set(selection.physicalWayIds),
    visibleFragmentIds: new Set(),
  };
  addVisibleFragments(selection, topology);
  addSemanticCarrierClosure(selection, topology);
  addTopologyWindows(selection, topology);
  addPhysicalCarriers(system, query, selection.physicalWayIds, topology.carriers);
  return {
    calls: topology.calls,
    fragments: [...topology.fragments.values()],
    windows: topology.windows,
    carriers: [...topology.carriers.values()],
    wayIds: topology.wayIds,
    visibleFragmentIds: topology.visibleFragmentIds,
  };
}

function placeClosure(
  system: TransitSystem,
  query: NetworkQuery,
  topology: TopologyClosure,
): PlaceClosure {
  const stopIds = new Set(
    system.stops.filter((stop) => pointInBounds(stop.coord, query.bounds)).map(({ id }) => id),
  );
  for (const call of topology.calls.values()) stopIds.add(call.stopId);
  const stops = system.stops.filter((stop) => stopIds.has(stop.id));
  const stationIds = new Set(
    system.stations
      .filter((station) => pointInBounds(station.coord, query.bounds))
      .map(({ id }) => id),
  );
  for (const stop of stops) if (stop.stationId) stationIds.add(stop.stationId);
  return {
    stops,
    stopIds,
    stations: system.stations.filter((station) => stationIds.has(station.id)),
    stationIds,
  };
}

function mapLaneDirection(direction: Way['profile']['lanes'][number]['direction']) {
  return direction === 'backward' ? ('reverse' as const) : direction;
}

function mapEntities(
  system: TransitSystem,
  selection: NetworkSelection,
  topology: TopologyClosure,
  places: PlaceClosure,
): ResolvedNetworkChunk['entities'] {
  const ways = system.ways.filter((way) => topology.wayIds.has(way.id));
  return {
    lines: selection.lines.map((line) => ({ id: line.id, name: line.name, color: line.color })),
    servicePlans: selection.services.map((service) => ({
      id: service.id,
      ...(service.name === undefined ? {} : { name: service.name }),
      mode: { kind: 'known', value: service.modeId },
      ...(service.vehicleKindId === undefined ? {} : { vehicleKindId: service.vehicleKindId }),
      activity: 'unknown',
    })),
    patterns: selection.patterns.map((pattern) => ({
      id: pattern.patternId,
      direction: { key: pattern.run },
      path: pattern.path,
    })),
    stops: places.stops.map((stop) => ({
      id: stop.id,
      ...(stop.name === undefined ? {} : { name: stop.name }),
      location: validCoordinate(stop.coord)
        ? { kind: 'known', value: stop.coord }
        : { kind: 'unknown' },
      ...(stop.stationId === undefined ? {} : { stationId: stop.stationId }),
      major: stop.majorStop ?? false,
    })),
    stations: places.stations.map((station) => ({
      id: station.id,
      ...(station.name === undefined ? {} : { name: station.name }),
      location: validCoordinate(station.coord)
        ? { kind: 'known', value: station.coord }
        : { kind: 'unknown' },
    })),
    alignments: ways.map((way) => ({ id: way.id })),
    ways: ways.map((way) => ({
      id: way.id,
      alignmentId: way.id,
      alignmentExtent: [0, 1],
      typeId: way.typeId,
      grade: way.grade,
      profile: {
        lanes: way.profile.lanes.map((lane) => ({
          id: lane.id,
          kindId: lane.kindId,
          widthMeters: lane.widthM,
          direction: mapLaneDirection(lane.direction),
        })),
      },
      ...(way.classId === undefined ? {} : { classId: way.classId }),
    })),
  };
}

function mappedCalls(
  selection: NetworkSelection,
  topology: TopologyClosure,
): ResolvedNetworkChunk['relationships']['patternStopCalls'] {
  return selection.patterns.flatMap((pattern) =>
    pattern.calls.flatMap((call) => {
      if (!topology.calls.has(call.id)) return [];
      const { pathOrder: _pathOrder, ...resolved } = call;
      return [resolved];
    }),
  );
}

function mapRelationships(
  selection: NetworkSelection,
  topology: TopologyClosure,
): ResolvedNetworkChunk['relationships'] {
  return {
    lineServicePlans: selection.lines.flatMap((line) =>
      line.serviceIds.flatMap((serviceId) =>
        selection.serviceIds.has(serviceId)
          ? [
              {
                id: legacyDerivedId('line-service-plan', line.id, serviceId),
                lineId: line.id,
                servicePlanId: serviceId,
              },
            ]
          : [],
      ),
    ),
    servicePlanPatterns: selection.patterns.map((pattern) => ({
      id: legacyDerivedId('service-plan-pattern', pattern.service.id, pattern.run),
      servicePlanId: pattern.service.id,
      patternId: pattern.patternId,
    })),
    patternStopCalls: mappedCalls(selection, topology),
    topologyWindows: topology.windows,
    replacements: [],
  };
}

function mapGeometry(topology: TopologyClosure): ResolvedNetworkChunk['geometry'] {
  return {
    carriers: topology.carriers,
    patternLegs: topology.fragments,
    visiblePatternLegFragmentIds: topology.fragments
      .filter((fragment) => topology.visibleFragmentIds.has(fragment.id))
      .map(({ id }) => id),
  };
}

export function mapChunk(
  system: TransitSystem,
  query: NetworkQuery,
  chunkId: string,
  checkpoint: () => Promise<void>,
): Promise<ResolvedNetworkChunk> {
  return mapChunkWithCheckpoints(system, query, chunkId, checkpoint);
}

async function mapChunkWithCheckpoints(
  system: TransitSystem,
  query: NetworkQuery,
  chunkId: string,
  checkpoint: () => Promise<void>,
): Promise<ResolvedNetworkChunk> {
  await checkpoint();
  const selection = selectNetwork(system, query);
  await checkpoint();
  const topology = topologyClosure(system, query, selection);
  await checkpoint();
  const places = placeClosure(system, query, topology);
  const lineIds = new Set(selection.lines.map(({ id }) => id));
  const serviceIds = new Set(selection.services.map(({ id }) => id));
  const infrastructure = mapInfrastructure({
    system,
    bounds: query.bounds,
    includedWayIds: topology.wayIds,
    includedStopIds: places.stopIds,
    includedStationIds: places.stationIds,
    includedLineIds: lineIds,
    includedServiceIds: serviceIds,
  });
  await checkpoint();
  return {
    id: chunkId,
    entities: mapEntities(system, selection, topology, places),
    relationships: mapRelationships(selection, topology),
    geometry: mapGeometry(topology),
    operationalChanges: [],
    advisories: [],
    infrastructure,
  };
}
