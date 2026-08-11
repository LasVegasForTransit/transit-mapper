import { resolveWayPath } from '../model/geo';
import type {
  Facility,
  Group,
  LngLat,
  NamedWay,
  Node,
  Service,
  Station,
  Way,
} from '../model/system';
import {
  facilityRenderCoordinate,
  groupFootprintPointRenderId,
  resolvedServiceTermini,
  stationFootprintPointRenderId,
  stationPlatformPointRenderId,
  wayControlPointRenderId,
} from './viewport-feature-identities';

export interface ViewportSpatialEntry {
  id: string;
  paths: readonly (readonly LngLat[])[];
  /** Closed areas whose interior contributes pixels, unlike corridor loops. */
  filledPaths?: readonly (readonly LngLat[])[];
}

function pointPath(coord: LngLat): readonly LngLat[][] {
  return [[coord]];
}

function closedPath(points: LngLat[]): readonly LngLat[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}

export function corridorViewportEntry(way: Way): ViewportSpatialEntry {
  // Culling uses the immutable control path. The settled renderer still owns
  // exact curve resolution; keeping that potentially large tessellation out
  // of cold index preparation lets long imported ways be indexed by bounded
  // point ranges. The viewport transition envelope is the conservative guard
  // around curved corners.
  return { id: way.id, paths: [way.points] };
}

export function corridorViewportEntries(ways: Way[]): ViewportSpatialEntry[] {
  return ways.map(corridorViewportEntry);
}

export function junctionViewportEntry(node: Node): ViewportSpatialEntry {
  return { id: node.id, paths: pointPath(node.coord) };
}

export function junctionViewportEntries(nodes: Node[]): ViewportSpatialEntry[] {
  return nodes.map(junctionViewportEntry);
}

export function stationViewportEntry(station: Station): ViewportSpatialEntry {
  const filledPaths = [
    ...(station.footprint ? [closedPath(station.footprint)] : []),
    ...(station.platforms ?? []).map(({ points }) => closedPath(points)),
  ];
  return {
    id: station.id,
    paths: [...pointPath(station.coord), ...filledPaths],
    filledPaths,
  };
}

export function stationViewportEntries(stations: Station[]): ViewportSpatialEntry[] {
  return stations.map(stationViewportEntry);
}

export function labelViewportEntries(namedWays: NamedWay[], ways: Way[]): ViewportSpatialEntry[] {
  const pathsByWay = new Map(ways.map((way) => [way.id, resolveWayPath(way)] as const));
  return namedWays.map((namedWay) => ({
    id: namedWay.id,
    paths: namedWay.wayIds
      .map((wayId) => pathsByWay.get(wayId))
      .filter((path): path is LngLat[] => path !== undefined),
  }));
}

export function wayHandleViewportEntries(ways: Way[]): ViewportSpatialEntry[] {
  return ways.flatMap((way) =>
    way.points.map((coord, pointIndex) => ({
      id: wayControlPointRenderId(way.id, pointIndex),
      paths: pointPath(coord),
    })),
  );
}

export function serviceTerminusViewportEntries(
  services: Service[],
  ways: Way[],
): ViewportSpatialEntry[] {
  const waysById = new Map(ways.map((way) => [way.id, way] as const));
  return services.flatMap((service) =>
    resolvedServiceTermini(service, waysById).map((terminus) => ({
      id: terminus.id,
      paths: pointPath(terminus.coord),
    })),
  );
}

export function facilityViewportEntry(facility: Facility): ViewportSpatialEntry {
  return {
    id: facility.id,
    paths: pointPath(facilityRenderCoordinate(facility)),
  };
}

export function facilityViewportEntries(facilities: Facility[]): ViewportSpatialEntry[] {
  return facilities.map(facilityViewportEntry);
}

export function groupViewportEntry(group: Group): ViewportSpatialEntry {
  const filledPaths = group.footprint ? [closedPath(group.footprint)] : [];
  return { id: group.id, paths: filledPaths, filledPaths };
}

export function groupViewportEntries(groups: Group[]): ViewportSpatialEntry[] {
  return groups.map(groupViewportEntry);
}

export function physicalHandleViewportEntries(
  stations: Station[],
  groups: Group[],
): ViewportSpatialEntry[] {
  const stationEntries = stations.flatMap((station) => [
    ...(station.footprint ?? []).map((coord, pointIndex) => ({
      id: stationFootprintPointRenderId(station.id, pointIndex),
      paths: pointPath(coord),
    })),
    ...(station.platforms ?? []).flatMap((platform) =>
      platform.points.map((coord, pointIndex) => ({
        id: stationPlatformPointRenderId(station.id, platform.id, pointIndex),
        paths: pointPath(coord),
      })),
    ),
  ]);
  const groupEntries = groups.flatMap((group) =>
    (group.footprint ?? []).map((coord, pointIndex) => ({
      id: groupFootprintPointRenderId(group.id, pointIndex),
      paths: pointPath(coord),
    })),
  );
  return [...stationEntries, ...groupEntries];
}
