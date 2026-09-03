import {
  FACILITY_TYPES,
  MODES,
  WAY_TYPES,
  type WayFamily,
} from '@transitmapper/core/model/catalog';
import { pathLengthMeters, patternRunPath } from '@transitmapper/core/model/geo';
import { linesById, servicePattern, servicesForLine } from '@transitmapper/core/model/line-service';
import type {
  Facility,
  Line,
  Station,
  Stop,
  TransitSystem,
} from '@transitmapper/core/model/system';
import { patternStops } from '@transitmapper/core/sim/serviceStats';
import type { DocumentRepresentationId } from '@transitmapper/map/presentation';
export interface SidebarStop {
  stopId: string;
  name: string;
}

export interface SidebarService {
  serviceId: string;
  name: string;
  explicitName?: string;
  modeId: string;
  stops: SidebarStop[];
}

interface SidebarSearchService extends SidebarService {
  serviceMatch: boolean;
}

export interface SidebarLineRow {
  line: Line;
  services: SidebarService[];
  lineMatch: boolean;
  searchServices: SidebarSearchService[];
}

export interface InfrastructureOutlineProjection {
  sections: InfrastructureSection[];
  stops: Stop[];
  stations: Station[];
  facilities: Facility[];
}

function nonBlank(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : fallback;
}

export interface InfrastructureSection {
  family: WayFamily;
  title: string;
  items: SidebarInfrastructureItem[];
}

export interface SidebarInfrastructureItem {
  identityId: string;
  name: string;
  primaryWayId: string;
  wayIds: string[];
  typeLabel: string;
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

export function sidebarSectionsForView(viewMode: DocumentRepresentationId): string[] {
  if (viewMode === 'infrastructure') {
    return [
      'Roads',
      'Railways and guideways',
      'Trails',
      'Waterways',
      'Other infrastructure',
      'Stops',
      'Stations',
      'Facilities',
    ];
  }
  return ['Lines', 'Stops', 'Stations'];
}

export function stopsForService(system: TransitSystem, serviceId: string): SidebarStop[] {
  const service = system.services.find((candidate) => candidate.id === serviceId);
  if (!service) return [];
  const pattern = servicePattern(service);
  const calls = (run: 'outbound' | 'inbound') => {
    const path = patternRunPath(system.ways, pattern, run);
    return patternStops(system.stops, pattern, path, pathLengthMeters(path), run);
  };
  const orderedCalls = [...calls('outbound'), ...calls('inbound')];
  const seen = new Set<string>();
  return orderedCalls.flatMap(({ stop }) => {
    if (seen.has(stop.id)) return [];
    seen.add(stop.id);
    return [
      {
        stopId: stop.id,
        name: nonBlank(stop.name, 'Unnamed stop'),
      },
    ];
  });
}

export function servicesForSidebarLine(system: TransitSystem, lineId: string): SidebarService[] {
  const lineName = linesById(system.lines).get(lineId)?.name;
  return servicesForLine(system, lineId).map((service, index, services) => {
    const explicitName = service.name?.trim();
    const fallback =
      services.length === 1 ? nonBlank(lineName, 'Unnamed line') : `Service ${index + 1}`;
    return {
      serviceId: service.id,
      ...(explicitName ? { explicitName } : {}),
      name: nonBlank(explicitName, fallback),
      modeId: service.modeId,
      stops: stopsForService(system, service.id),
    };
  });
}

function serviceSearchResult(
  service: SidebarService,
  serviceCount: number,
  normalized: string,
): SidebarSearchService | null {
  const visibleServiceName = serviceCount > 1 ? service.name : undefined;
  const serviceMatch = [service.explicitName, visibleServiceName, MODES[service.modeId].label].some(
    (value) => value?.toLocaleLowerCase().includes(normalized),
  );
  const stops = service.stops.filter((stop) => stop.name.toLocaleLowerCase().includes(normalized));
  return serviceMatch || stops.length > 0 ? { ...service, stops, serviceMatch } : null;
}

export function networkLineRows(system: TransitSystem, normalized: string): SidebarLineRow[] {
  const rows: SidebarLineRow[] = [];
  for (const line of system.lines) {
    const services = servicesForSidebarLine(system, line.id);
    const lineMatch = normalized.length > 0 && line.name.toLocaleLowerCase().includes(normalized);
    const searchServices: SidebarSearchService[] = [];
    if (normalized) {
      for (const service of services) {
        const result = serviceSearchResult(service, services.length, normalized);
        if (result) searchServices.push(result);
      }
    }
    if (!normalized || lineMatch || searchServices.length > 0) {
      rows.push({ line, services, lineMatch, searchServices });
    }
  }
  return rows;
}

const FAMILY_TITLES: Record<WayFamily, string> = {
  roadway: 'Roads',
  guideway: 'Railways and guideways',
  path: 'Trails',
  aerial: 'Other infrastructure',
  water: 'Waterways',
};

export function infrastructureSections(system: TransitSystem): InfrastructureSection[] {
  const waysById = new Map(system.ways.map((way) => [way.id, way]));
  const byTitle = new Map<string, InfrastructureSection>();
  for (const identity of system.namedWays) {
    const ways = identity.wayIds.flatMap((wayId) => {
      const way = waysById.get(wayId);
      return way ? [way] : [];
    });
    const firstWay = ways.at(0);
    if (!firstWay) continue;
    const family = WAY_TYPES[firstWay.typeId].family;
    const title = FAMILY_TITLES[family];
    const typeLabels = [...new Set(ways.map((way) => WAY_TYPES[way.typeId].label))];
    const section = byTitle.get(title) ?? { family, title, items: [] };
    section.items.push({
      identityId: identity.id,
      name: nonBlank(
        identity.name,
        `Unnamed ${typeLabels.at(0)?.toLocaleLowerCase() ?? 'infrastructure'}`,
      ),
      primaryWayId: firstWay.id,
      wayIds: ways.map((way) => way.id),
      typeLabel: typeLabels.length === 1 ? typeLabels[0] : `${typeLabels.length} types`,
    });
    byTitle.set(title, section);
  }
  return ['Roads', 'Railways and guideways', 'Trails', 'Waterways', 'Other infrastructure'].flatMap(
    (title) => {
      const section = byTitle.get(title);
      return section && section.items.length > 0 ? [section] : [];
    },
  );
}

export function infrastructureOutlineProjection(
  system: TransitSystem,
  normalized: string,
): InfrastructureOutlineProjection {
  const sections = infrastructureSections(system)
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          !normalized ||
          [item.name, item.typeLabel].some((label) =>
            label.toLocaleLowerCase().includes(normalized),
          ),
      ),
    }))
    .filter((section) => section.items.length > 0);
  const stops = system.stops.filter(
    (stop) => !normalized || (stop.name ?? 'Unnamed stop').toLocaleLowerCase().includes(normalized),
  );
  const stations = system.stations.filter(
    (station) =>
      !normalized || (station.name ?? 'Unnamed station').toLocaleLowerCase().includes(normalized),
  );
  const facilities = system.facilities.filter((facility) => {
    const label = facility.name ?? FACILITY_TYPES[facility.typeId].label;
    return !normalized || label.toLocaleLowerCase().includes(normalized);
  });
  return { sections, stops, stations, facilities };
}
