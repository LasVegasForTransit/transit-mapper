import { facilityType, mode, wayType } from '@transitmapper/core/model/catalog';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { MapFeatureDetails } from '@transitmapper/map';
import type { MapFeatureReferenceV1 } from '@transitmapper/views';
import type { DocumentMapSnapshot } from './document-map-driver-types';

type DocumentFeatureReference = MapFeatureReferenceV1 & { source: 'document' };
type DetailResolver = (
  system: TransitSystem,
  reference: DocumentFeatureReference,
) => MapFeatureDetails | null;

function titleOrFallback(name: string | undefined, kind: string): string {
  return name?.trim() ?? kind;
}

const detailResolvers: Readonly<Partial<Record<string, DetailResolver>>> = {
  line: (system, reference) => {
    const line = system.lines.find((item) => item.id === reference.id);
    return line
      ? {
          reference,
          title: line.name,
          fields: [{ label: 'Services', value: String(line.serviceIds.length) }],
        }
      : null;
  },
  service: (system, reference) => {
    const service = system.services.find((item) => item.id === reference.id);
    return service
      ? {
          reference,
          title: titleOrFallback(service.name, mode(service.modeId).label),
          fields: [{ label: 'Mode', value: mode(service.modeId).label }],
        }
      : null;
  },
  stop: (system, reference) => {
    const stop = system.stops.find((item) => item.id === reference.id);
    return stop ? { reference, title: titleOrFallback(stop.name, 'Stop'), fields: [] } : null;
  },
  station: (system, reference) => {
    const station = system.stations.find((item) => item.id === reference.id);
    return station
      ? { reference, title: titleOrFallback(station.name, 'Station'), fields: [] }
      : null;
  },
  facility: (system, reference) => {
    const facility = system.facilities.find((item) => item.id === reference.id);
    return facility
      ? {
          reference,
          title: titleOrFallback(facility.name, facilityType(facility.typeId).label),
          fields: [{ label: 'Type', value: facilityType(facility.typeId).label }],
        }
      : null;
  },
  group: (system, reference) => {
    const group = system.groups.find((item) => item.id === reference.id);
    return group ? { reference, title: titleOrFallback(group.name, 'Group'), fields: [] } : null;
  },
  way: (system, reference) => {
    const way = system.ways.find((item) => item.id === reference.id);
    if (!way) return null;
    const namedWay = system.namedWays.find((item) => item.wayIds.includes(way.id));
    return {
      reference,
      title: titleOrFallback(namedWay?.name, wayType(way.typeId).label),
      fields: [{ label: 'Type', value: wayType(way.typeId).label }],
    };
  },
  node: (system, reference) => {
    const node = system.nodes.find((item) => item.id === reference.id);
    return node
      ? {
          reference,
          title: 'Junction',
          fields: [{ label: 'Ways', value: String(node.refs.length) }],
        }
      : null;
  },
};

export function documentMapFeatureDetails(
  snapshot: DocumentMapSnapshot,
  reference: MapFeatureReferenceV1,
): MapFeatureDetails | null {
  if (reference.source !== 'document') return null;
  const resolver = detailResolvers[reference.kind];
  return resolver ? resolver(snapshot.system, reference as DocumentFeatureReference) : null;
}
