import { pointAtT, resolveWayPath } from './geo';
import type { SelectionRef } from './selectionActions';
import type { Facility, LngLat, Station, TransitSystem, Way } from './system';

function translate(coord: LngLat, dx: number, dy: number): LngLat {
  return [coord[0] + dx, coord[1] + dy];
}

function movedWays(
  ways: Way[],
  selectedWayIds: Set<string>,
  dx: number,
  dy: number,
): { ways: Way[]; changed: Map<string, Way> } {
  const changed = new Map<string, Way>();
  const next = ways.map((way) => {
    if (!selectedWayIds.has(way.id) || way.points.length === 0) return way;
    const moved = { ...way, points: way.points.map((point) => translate(point, dx, dy)) };
    changed.set(way.id, moved);
    return moved;
  });
  return { ways: changed.size > 0 ? next : ways, changed };
}

function sameCoordinate(a: LngLat, b: LngLat): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

interface MoveStationsOptions {
  selectedStationIds: Set<string>;
  selectedWayIds: Set<string>;
  changedWays: Map<string, Way>;
  dx: number;
  dy: number;
}

function movedStations(stations: Station[], options: MoveStationsOptions): Station[] {
  const next = stations.map((station) => {
    const movedAnchor = station.anchors.find((anchor) => options.changedWays.has(anchor.wayId));
    const way = movedAnchor && options.changedWays.get(movedAnchor.wayId);
    if (movedAnchor && way) {
      const path = resolveWayPath(way);
      if (path.length >= 2) {
        const coord = pointAtT(path, movedAnchor.t);
        if (!sameCoordinate(coord, station.coord)) {
          return { ...station, coord };
        }
      }
      return station;
    }
    const followsSelectedWay = station.anchors.some((candidate) =>
      options.selectedWayIds.has(candidate.wayId),
    );
    if (!options.selectedStationIds.has(station.id) || followsSelectedWay) return station;
    return { ...station, coord: translate(station.coord, options.dx, options.dy) };
  });
  return next.some((station, index) => station !== stations[index]) ? next : stations;
}

function movedFacilities(
  facilities: Facility[],
  selectedFacilityIds: Set<string>,
  dx: number,
  dy: number,
): Facility[] {
  const next = facilities.map((facility) => {
    if (!selectedFacilityIds.has(facility.id)) return facility;
    const geometry: LngLat | LngLat[] = Array.isArray(facility.geometry[0])
      ? (facility.geometry as LngLat[]).map((point) => translate(point, dx, dy))
      : translate(facility.geometry as LngLat, dx, dy);
    return { ...facility, geometry };
  });
  return next.some((facility, index) => facility !== facilities[index]) ? next : facilities;
}

function ids(items: SelectionRef[], kind: SelectionRef['kind']): Set<string> {
  return new Set(items.filter((item) => item.kind === kind).map((item) => item.id));
}

/** Rigidly translates selected physical records without applying timestamp policy. */
export function nudgeSelection(
  system: TransitSystem,
  items: SelectionRef[],
  dx: number,
  dy: number,
): TransitSystem {
  if (dx === 0 && dy === 0) return system;
  const wayIds = ids(items, 'way');
  const moved = movedWays(system.ways, wayIds, dx, dy);
  const stations = movedStations(system.stations, {
    selectedStationIds: ids(items, 'station'),
    selectedWayIds: wayIds,
    changedWays: moved.changed,
    dx,
    dy,
  });
  const facilities = movedFacilities(system.facilities, ids(items, 'facility'), dx, dy);
  if (
    moved.ways === system.ways &&
    stations === system.stations &&
    facilities === system.facilities
  ) {
    return system;
  }
  return { ...system, ways: moved.ways, stations, facilities };
}
