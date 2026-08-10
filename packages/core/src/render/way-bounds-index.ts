import type { LngLat, Node, Way } from '../model/system';
import { isOsmImportedWay } from './infrastructure-detail';

const CELL_DEGREES = 0.1;
interface WayBoundsIndex {
  cells: Map<string, Way[]>;
  handDrawn: Way[];
  order: Map<string, number>;
}
const cache = new WeakMap<Way[], WayBoundsIndex>();
const nodesByWayCache = new WeakMap<Node[], Map<string, Node[]>>();
const cellKey = (x: number, y: number): string => `${x}:${y}`;
const cell = (coordinate: number): number => Math.floor(coordinate / CELL_DEGREES);

function buildIndex(ways: Way[]): WayBoundsIndex {
  const cached = cache.get(ways);
  if (cached) return cached;
  const index: WayBoundsIndex = { cells: new Map(), handDrawn: [], order: new Map() };
  ways.forEach((way, order) => {
    index.order.set(way.id, order);
    if (!isOsmImportedWay(way)) {
      index.handDrawn.push(way);
      return;
    }
    if (way.points.length === 0) return;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [longitude, latitude] of way.points) {
      west = Math.min(west, longitude);
      south = Math.min(south, latitude);
      east = Math.max(east, longitude);
      north = Math.max(north, latitude);
    }
    for (let x = cell(west); x <= cell(east); x++) {
      for (let y = cell(south); y <= cell(north); y++) {
        const key = cellKey(x, y);
        const entries = index.cells.get(key);
        if (entries) entries.push(way);
        else index.cells.set(key, [way]);
      }
    }
  });
  cache.set(ways, index);
  return index;
}

/** Spatially narrow imported topology while retaining every hand-drawn and selected way. */
export function waysInBoundsFor(
  ways: Way[],
  bounds: [LngLat, LngLat],
  selectedWayId?: string,
): Way[] {
  const index = buildIndex(ways);
  const found = new Map<string, Way>();
  for (const way of index.handDrawn) found.set(way.id, way);
  const [[west, south], [east, north]] = bounds;
  for (let x = cell(west); x <= cell(east); x++) {
    for (let y = cell(south); y <= cell(north); y++) {
      for (const way of index.cells.get(cellKey(x, y)) ?? []) found.set(way.id, way);
    }
  }
  if (selectedWayId) {
    const selected = ways.find((way) => way.id === selectedWayId);
    if (selected) found.set(selected.id, selected);
  }
  return [...found.values()].sort(
    (left, right) => (index.order.get(left.id) ?? 0) - (index.order.get(right.id) ?? 0),
  );
}

/** Resolve only junction candidates touched by the already viewport-narrowed ways. */
export function nodesForWays(nodes: Node[], ways: Way[]): Node[] {
  let nodesByWay = nodesByWayCache.get(nodes);
  if (!nodesByWay) {
    nodesByWay = new Map();
    for (const node of nodes) {
      for (const ref of node.refs) {
        const entries = nodesByWay.get(ref.wayId);
        if (entries) entries.push(node);
        else nodesByWay.set(ref.wayId, [node]);
      }
    }
    nodesByWayCache.set(nodes, nodesByWay);
  }
  const found = new Map<string, Node>();
  for (const way of ways) {
    for (const node of nodesByWay.get(way.id) ?? []) found.set(node.id, node);
  }
  return [...found.values()];
}
