import { pointAtT, resolveWayPath } from './geo';
import type { SelectionRef } from './selectionActions';
import type { Facility, LngLat, Node, Stop, TransitSystem, Way, WayPointRef } from './system';

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

function refMoved(ref: WayPointRef, changedWays: Map<string, Way>): boolean {
  return changedWays.get(ref.wayId)?.points[ref.pointIndex] !== undefined;
}

function disconnectedNode(node: Node, refs: WayPointRef[], movedWayIds: Set<string>): Node {
  const next = { ...node, refs };
  if (!node.connectors) return next;
  const connectors = node.connectors.filter(
    (connector) => !movedWayIds.has(connector.from.wayId) && !movedWayIds.has(connector.to.wayId),
  );
  if (connectors.length === node.connectors.length) return next;
  if (connectors.length > 0) return { ...next, connectors };
  const { connectors: _removed, ...withoutConnectors } = next;
  return withoutConnectors;
}

function movedNodes(nodes: Node[], changedWays: Map<string, Way>, dx: number, dy: number): Node[] {
  let changed = false;
  const next: Node[] = [];
  for (const node of nodes) {
    const movedRefs = node.refs.filter((ref) => refMoved(ref, changedWays));
    if (movedRefs.length === 0) {
      next.push(node);
      continue;
    }
    changed = true;
    if (movedRefs.length === node.refs.length) {
      next.push({ ...node, coord: translate(node.coord, dx, dy) });
      continue;
    }
    const refs = node.refs.filter((ref) => !refMoved(ref, changedWays));
    if (refs.length < 2) continue;
    next.push(disconnectedNode(node, refs, new Set(movedRefs.map((ref) => ref.wayId))));
  }
  return changed ? next : nodes;
}

interface MoveStopsOptions {
  selectedStopIds: Set<string>;
  selectedWayIds: Set<string>;
  changedWays: Map<string, Way>;
  dx: number;
  dy: number;
}

function movedStops(stops: Stop[], options: MoveStopsOptions): Stop[] {
  const next = stops.map((stop) => {
    const movedAnchor = stop.anchors.find((anchor) => options.changedWays.has(anchor.wayId));
    const way = movedAnchor && options.changedWays.get(movedAnchor.wayId);
    if (movedAnchor && way) {
      const path = resolveWayPath(way);
      if (path.length >= 2) {
        const coord = pointAtT(path, movedAnchor.t);
        if (!sameCoordinate(coord, stop.coord)) {
          return { ...stop, coord };
        }
      }
      return stop;
    }
    const followsSelectedWay = stop.anchors.some((candidate) =>
      options.selectedWayIds.has(candidate.wayId),
    );
    if (!options.selectedStopIds.has(stop.id) || followsSelectedWay) return stop;
    return { ...stop, coord: translate(stop.coord, options.dx, options.dy) };
  });
  return next.some((stop, index) => stop !== stops[index]) ? next : stops;
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
  const nodes = movedNodes(system.nodes, moved.changed, dx, dy);
  const stops = movedStops(system.stops, {
    selectedStopIds: ids(items, 'stop'),
    selectedWayIds: wayIds,
    changedWays: moved.changed,
    dx,
    dy,
  });
  const facilities = movedFacilities(system.facilities, ids(items, 'facility'), dx, dy);
  if (
    moved.ways === system.ways &&
    nodes === system.nodes &&
    stops === system.stops &&
    facilities === system.facilities
  ) {
    return system;
  }
  return { ...system, ways: moved.ways, nodes, stops, facilities };
}
