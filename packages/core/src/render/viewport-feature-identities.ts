import { legRange, patternRunLegs, pointAtT, resolveWayPath } from '../model/geo';
import type { Facility, LngLat, Service, Way } from '../model/system';
import { renderFeatureId, systemFeatureSourceId, type RenderFeatureId } from './render-identity';

const HANDLE_SOURCE_ID = systemFeatureSourceId('handles');
const SERVICE_TERMINUS_SOURCE_ID = systemFeatureSourceId('service-termini');
const PHYSICAL_HANDLE_SOURCE_ID = systemFeatureSourceId('physical-handles');

export type ServiceTerminusSide = 'start' | 'end';

export interface ResolvedServiceTerminus {
  readonly id: RenderFeatureId;
  readonly serviceId: string;
  readonly patternId: string;
  readonly side: ServiceTerminusSide;
  readonly coord: LngLat;
}

export interface ServiceTerminusDescriptor {
  readonly id: RenderFeatureId;
  readonly serviceId: string;
  readonly patternId: string;
  readonly side: ServiceTerminusSide;
  readonly wayId: string;
  readonly t: number;
}

export function wayControlPointRenderId(wayId: string, pointIndex: number): RenderFeatureId {
  return renderFeatureId(HANDLE_SOURCE_ID, 'control-point', [wayId, pointIndex]);
}

export function serviceTerminusRenderId(
  serviceId: string,
  patternId: string,
  side: ServiceTerminusSide,
): RenderFeatureId {
  return renderFeatureId(SERVICE_TERMINUS_SOURCE_ID, 'terminus', [serviceId, patternId, side]);
}

export function stationFootprintPointRenderId(
  stationId: string,
  pointIndex: number,
): RenderFeatureId {
  return renderFeatureId(PHYSICAL_HANDLE_SOURCE_ID, 'station-footprint-point', [
    stationId,
    pointIndex,
  ]);
}

export function stationPlatformPointRenderId(
  stationId: string,
  platformId: string,
  pointIndex: number,
): RenderFeatureId {
  return renderFeatureId(PHYSICAL_HANDLE_SOURCE_ID, 'station-platform-point', [
    stationId,
    platformId,
    pointIndex,
  ]);
}

export function groupFootprintPointRenderId(groupId: string, pointIndex: number): RenderFeatureId {
  return renderFeatureId(PHYSICAL_HANDLE_SOURCE_ID, 'group-footprint-point', [groupId, pointIndex]);
}

/** Resolves the exact points the editor presents as termini. Keeping this
 * shared with the viewport index prevents spatial admission and feature
 * projection from disagreeing about partial-leg endpoints. */
export function serviceTerminusDescriptors(service: Service): ServiceTerminusDescriptor[] {
  const termini: ServiceTerminusDescriptor[] = [];
  const pattern = service.path;
  const outbound = patternRunLegs(pattern, 'outbound');
  const ends: readonly {
    side: ServiceTerminusSide;
    entry: (typeof outbound)[number] | undefined;
  }[] = [
    { side: 'start', entry: outbound[0] },
    { side: 'end', entry: outbound[outbound.length - 1] },
  ];
  for (const { side, entry } of ends) {
    if (!entry) continue;
    const [lo, hi] = legRange(entry.leg);
    const isStart = side === 'start';
    const t = isStart === entry.forward ? lo : hi;
    termini.push({
      id: serviceTerminusRenderId(service.id, pattern.id, side),
      serviceId: service.id,
      patternId: pattern.id,
      side,
      wayId: entry.leg.wayId,
      t,
    });
  }
  return termini;
}

export function resolveServiceTerminus(
  descriptor: ServiceTerminusDescriptor,
  waysById: ReadonlyMap<string, Way>,
): ResolvedServiceTerminus | null {
  const way = waysById.get(descriptor.wayId);
  if (!way) return null;
  return {
    id: descriptor.id,
    serviceId: descriptor.serviceId,
    patternId: descriptor.patternId,
    side: descriptor.side,
    coord: pointAtT(resolveWayPath(way), descriptor.t),
  };
}

export function resolvedServiceTermini(
  service: Service,
  waysById: ReadonlyMap<string, Way>,
): ResolvedServiceTerminus[] {
  return serviceTerminusDescriptors(service).flatMap((descriptor) => {
    const terminus = resolveServiceTerminus(descriptor, waysById);
    return terminus ? [terminus] : [];
  });
}

/** Facilities currently present one icon even when authored as an area. The
 * viewport index must admit that exact icon coordinate, not a different area
 * silhouette that this render pass does not draw. */
export function facilityRenderCoordinate(facility: Facility): LngLat {
  return Array.isArray(facility.geometry[0])
    ? (facility.geometry as LngLat[])[0]
    : (facility.geometry as LngLat);
}
