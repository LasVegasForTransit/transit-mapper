import { WAY_TYPES } from '@transitmapper/core/model/catalog';
import { pathLengthMeters, patternPath, patternWayIds } from '@transitmapper/core/model/geo';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { patternStops } from '@transitmapper/core/sim/serviceStats';
import type { ViewMode } from './ViewProvider';

interface SidebarStop {
  stationId: string;
  name: string;
}

export interface SidebarPattern {
  patternId: string;
  name: string | undefined;
  stops: SidebarStop[];
}

export interface NetworkCorridor {
  id: string;
  label: string;
  typeId: string;
  wayIds: string[];
  serviceIds: string[];
  stationIds: string[];
}

interface NetworkCorridorSource {
  ways: TransitSystem['ways'];
  namedWays: TransitSystem['namedWays'];
  services: TransitSystem['services'];
  stations: TransitSystem['stations'];
}

export interface LimitedSidebarItems<T> {
  items: T[];
  hiddenCount: number;
}

export function sidebarTabStopKey(
  firstVisibleKey: string | null,
  selectedKey: string | null,
  selectedIsVisible: boolean,
): string | null {
  return selectedKey && selectedIsVisible ? selectedKey : firstVisibleKey;
}

export function limitSidebarItems<T>(
  items: T[],
  expanded: boolean,
  limit: number,
): LimitedSidebarItems<T> {
  const visible = expanded ? items : items.slice(0, limit);
  return { items: visible, hiddenCount: items.length - visible.length };
}

export function limitSidebarPatterns(
  patterns: SidebarPattern[],
  expanded: boolean,
  limit: number,
): LimitedSidebarItems<SidebarPattern> {
  if (expanded) return { items: patterns, hiddenCount: 0 };

  let remaining = limit;
  const items = patterns.map((pattern) => {
    const stops = pattern.stops.slice(0, remaining);
    remaining -= stops.length;
    return { ...pattern, stops };
  });
  const totalStops = patterns.reduce((total, pattern) => total + pattern.stops.length, 0);
  return { items, hiddenCount: Math.max(0, totalStops - limit) };
}

export function sidebarSectionsForView(viewMode: ViewMode): string[] {
  if (viewMode === 'infrastructure') return ['Corridors', 'Stations', 'Complexes and facilities'];
  // Diagram borrows the network's sections. It is a schematic projection OF
  // that network — the same lines without the geography — so the list of
  // lines is exactly as useful there, and picking one still selects it.
  //
  // It used to have sections of its own, holding mode checkboxes and a
  // Landmarks toggle. Those belong to the Layers control, read from the same
  // ViewProvider state, and in Diagram view on a phone both copies were on
  // screen at once.
  return ['Lines', 'Vehicles'];
}

export function lineStopsForService(system: TransitSystem, serviceId: string): SidebarPattern[] {
  const service = system.services.find((candidate) => candidate.id === serviceId);
  if (!service) return [];
  return service.patterns.map((pattern) => {
    const path = patternPath(system.ways, pattern);
    return {
      patternId: pattern.id,
      name: pattern.name,
      stops: patternStops(system.stations, pattern, path, pathLengthMeters(path), 'outbound').map(
        ({ station }) => ({
          stationId: station.id,
          name: station.name || 'Unnamed station',
        }),
      ),
    };
  });
}

export function networkCorridors(system: NetworkCorridorSource): NetworkCorridor[] {
  const wayById = new Map(system.ways.map((way) => [way.id, way]));
  const serviceOrder = new Map(system.services.map((service, index) => [service.id, index]));
  const stationOrder = new Map(system.stations.map((station, index) => [station.id, index]));
  const serviceIdsByWay = new Map<string, Set<string>>();
  system.services.forEach((service) => {
    new Set(service.patterns.flatMap((pattern) => patternWayIds(pattern))).forEach((wayId) => {
      const serviceIds = serviceIdsByWay.get(wayId) ?? new Set<string>();
      serviceIds.add(service.id);
      serviceIdsByWay.set(wayId, serviceIds);
    });
  });
  const stationIdsByWay = new Map<string, Set<string>>();
  system.stations.forEach((station) => {
    station.anchors.forEach((anchor) => {
      const stationIds = stationIdsByWay.get(anchor.wayId) ?? new Set<string>();
      stationIds.add(station.id);
      stationIdsByWay.set(anchor.wayId, stationIds);
    });
  });
  const claimed = new Set<string>();
  const corridors: NetworkCorridor[] = [];

  const addCorridor = (id: string, label: string, wayIds: string[]) => {
    const existingWayIds = wayIds.filter((wayId) => wayById.has(wayId));
    const corridorServiceIds = new Set(
      existingWayIds.flatMap((wayId) => [...(serviceIdsByWay.get(wayId) ?? [])]),
    );
    const serviceIds = [...corridorServiceIds].sort(
      (left, right) => (serviceOrder.get(left) ?? 0) - (serviceOrder.get(right) ?? 0),
    );
    if (serviceIds.length === 0 || existingWayIds.length === 0) return;

    const corridorStationIds = new Set(
      existingWayIds.flatMap((wayId) => [...(stationIdsByWay.get(wayId) ?? [])]),
    );
    const stationIds = [...corridorStationIds].sort(
      (left, right) => (stationOrder.get(left) ?? 0) - (stationOrder.get(right) ?? 0),
    );
    corridors.push({
      id,
      label,
      typeId: wayById.get(existingWayIds[0])?.typeId ?? 'road',
      wayIds: existingWayIds,
      serviceIds,
      stationIds,
    });
    existingWayIds.forEach((wayId) => claimed.add(wayId));
  };

  system.namedWays.forEach((namedWay) =>
    addCorridor(`named:${namedWay.id}`, namedWay.name, namedWay.wayIds),
  );

  system.ways.forEach((way) => {
    if (claimed.has(way.id)) return;
    if (!serviceIdsByWay.has(way.id)) return;
    addCorridor(`way:${way.id}`, WAY_TYPES[way.typeId]?.label ?? way.typeId, [way.id]);
  });

  return corridors;
}
