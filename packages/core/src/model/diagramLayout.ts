/**
 * The pure Diagram layout boundary.
 *
 * Geographic documents stay immutable. This module produces a separate,
 * serializable schematic result whose ways, nodes, and stop anchors agree on
 * one coordinate system. The browser Worker owns when that work runs; core
 * owns the actual topology and geometry decisions. It does not choose label
 * candidates or animate map transitions: those presentation concerns consume
 * this stable result after layout has finished.
 */
import { metersFromOrigin, offsetMeters } from './geo';
import {
  detouredDiagramRoutes,
  diagramEdgeKey,
  type DiagramEdgeRoutes,
  type DiagramRouteEdge,
} from './diagram-layout-routes';
import { diagramStationsFor } from './diagram-layout-stations';
import { diagramStopsFor, type DiagramStopPlacementOperationCounts } from './diagram-layout-stops';
import {
  diagramNodePositions,
  diagramNodesFor,
  diagramTopologyRevision,
} from './diagram-layout-topology';
import { diagramLabelAnchorsFor } from './diagram-layout-labels';
import type { LngLat, Node, TransitSystem, Way } from './system';

export interface DiagramLayoutOperationCounts extends DiagramStopPlacementOperationCounts {
  diagramTopologyBuildCount: number;
  diagramTopologyCacheHitCount: number;
}

export interface DiagramLayoutResult {
  /** The transient system consumed by existing Diagram renderers. */
  readonly system: TransitSystem;
  /** Schematic positions for every named junction, including isolated nodes. */
  readonly nodePositions: Readonly<Record<string, LngLat>>;
  /** Stop positions after anchoring against the schematic ways. */
  readonly stopAnchors: Readonly<Record<string, LngLat>>;
  /** Station focus points derived from their schematic member stops. */
  readonly stationAnchors: Readonly<Record<string, LngLat>>;
  /** One semantic anchor per NamedWay, on its longest schematic member. */
  readonly labelAnchors: Readonly<Record<string, LngLat>>;
  /** A deterministic fingerprint of the topology this result describes. */
  readonly topologyRevision: string;
}

interface DiagramTopology {
  readonly ways: Way[];
  readonly nodePositions: Readonly<Record<string, LngLat>>;
  readonly topologyRevision: string;
}

const topologyCache = new WeakMap<Way[], WeakMap<Node[], DiagramTopology>>();
const layoutCache = new WeakMap<TransitSystem, DiagramLayoutResult>();

/** The schematic-layout projection of `system`, memoized by the immutable
 * collections each stage actually reads. A facility/service/meta edit creates
 * a new TransitSystem wrapper but keeps `ways` and `nodes`; it must not rerun
 * sixty relaxation passes. Stop placement is cached separately so a stop
 * edit remaps stops onto the already-schematic ways without rebuilding the
 * topology. */
export function layoutDiagram(
  system: TransitSystem,
  counts?: DiagramLayoutOperationCounts,
): DiagramLayoutResult {
  const cached = layoutCache.get(system);
  if (cached) return cached;
  const topology = diagramWaysFor(system.ways, system.nodes, counts);
  const ways = topology.ways;
  const stops = ways === system.ways ? system.stops : diagramStopsFor(system.stops, ways, counts);
  const stations =
    stops === system.stops ? system.stations : diagramStationsFor(system.stations, stops);
  const nodes = diagramNodesFor(system.nodes, topology.nodePositions);
  const stopAnchors = Object.fromEntries(stops.map((stop) => [stop.id, stop.coord]));
  const stationAnchors = Object.fromEntries(stations.map((station) => [station.id, station.coord]));
  const labelAnchors = diagramLabelAnchorsFor(system.namedWays, ways);
  const projected =
    ways === system.ways &&
    stops === system.stops &&
    stations === system.stations &&
    nodes === system.nodes
      ? system
      : { ...system, ways, nodes, stops, stations };
  const result: DiagramLayoutResult = {
    system: projected,
    nodePositions: topology.nodePositions,
    stopAnchors,
    stationAnchors,
    labelAnchors,
    topologyRevision: topology.topologyRevision,
  };
  layoutCache.set(system, result);
  return result;
}

/** Compatibility for existing rendering callers. New code should carry the
 * full layout result when it needs anchors or revision identity. */
export function computeDiagramSystem(
  system: TransitSystem,
  counts?: DiagramLayoutOperationCounts,
): TransitSystem {
  return layoutDiagram(system, counts).system;
}

interface WayVertex {
  /** Index into the original way.points array. */
  index: number;
  /** "node:<id>" for a real junction, "end:<wayId>:<index>" for a dead end —
   *  shared across ways only when it's a genuine Node. */
  key: string;
}

interface DiagramGraph {
  readonly wayVertices: ReadonlyMap<string, readonly WayVertex[]>;
  readonly vertexSeed: ReadonlyMap<string, LngLat>;
  readonly edges: readonly DiagramRouteEdge[];
}

/** A disconnected component is solved in its own local plane. That keeps a
 * west-side edit from changing the centroid—and therefore the floating-point
 * output—of an unrelated east-side schematic. */
interface DiagramComponent {
  readonly vertexSeed: ReadonlyMap<string, LngLat>;
  readonly edges: readonly DiagramRouteEdge[];
}

const DIRECTIONS = 8;
const ANGLE_STEP = (2 * Math.PI) / DIRECTIONS;
const ITERATIONS = 60;
const EASE = 0.35;
const MIN_EDGE_METERS = 10; // numerical floor only, not a stylistic minimum

function diagramWaysFor(
  ways: Way[],
  nodes: Node[],
  counts?: DiagramLayoutOperationCounts,
): DiagramTopology {
  let byNodes = topologyCache.get(ways);
  if (!byNodes) {
    byNodes = new WeakMap();
    topologyCache.set(ways, byNodes);
  }
  const cached = byNodes.get(nodes);
  if (cached) {
    if (counts) counts.diagramTopologyCacheHitCount++;
    return cached;
  }
  if (counts) counts.diagramTopologyBuildCount++;
  const projected = buildDiagramWays(ways, nodes);
  byNodes.set(nodes, projected);
  return projected;
}

function buildDiagramWays(ways: Way[], nodes: Node[]): DiagramTopology {
  if (ways.length === 0) {
    return unchangedDiagramTopology(ways, nodes);
  }
  const graph = diagramGraph(ways, nodes);
  if (graph.vertexSeed.size === 0) return unchangedDiagramTopology(ways, nodes);

  const finalCoordinates = relaxDiagramGraph(graph);
  const edgeRoutes = detouredDiagramRoutes(graph.edges, graph.vertexSeed, finalCoordinates);
  return {
    ways: projectDiagramWays(ways, graph.wayVertices, finalCoordinates, edgeRoutes),
    nodePositions: diagramNodePositions(nodes, finalCoordinates),
    topologyRevision: diagramTopologyRevision(ways, nodes),
  };
}

/** Builds the named topology once. A way endpoint has its own identity;
 * only a model Node may join two ways in the schematic. */
function diagramGraph(ways: readonly Way[], nodes: readonly Node[]): DiagramGraph {
  const nodeReferences = diagramNodeReferences(nodes);
  const wayVertices = new Map<string, WayVertex[]>();
  const vertexSeed = new Map<string, LngLat>();

  for (const way of ways) {
    appendWayVertices(way, nodeReferences, wayVertices, vertexSeed);
  }
  return { wayVertices, vertexSeed, edges: diagramEdges(wayVertices) };
}

interface DiagramNodeReferences {
  readonly keyByWayPoint: ReadonlyMap<string, string>;
  readonly indicesByWay: ReadonlyMap<string, readonly number[]>;
}

function diagramNodeReferences(nodes: readonly Node[]): DiagramNodeReferences {
  const keyByWayPoint = new Map<string, string>();
  const indicesByWay = new Map<string, number[]>();
  for (const node of nodes) {
    for (const ref of node.refs) {
      keyByWayPoint.set(`${ref.wayId}:${ref.pointIndex}`, `node:${node.id}`);
      const list = indicesByWay.get(ref.wayId);
      if (list) list.push(ref.pointIndex);
      else indicesByWay.set(ref.wayId, [ref.pointIndex]);
    }
  }
  return { keyByWayPoint, indicesByWay };
}

function appendWayVertices(
  way: Way,
  nodeReferences: DiagramNodeReferences,
  wayVertices: Map<string, WayVertex[]>,
  vertexSeed: Map<string, LngLat>,
): void {
  if (way.points.length < 2) return;

  const indices = new Set<number>([0, way.points.length - 1]);
  for (const index of nodeReferences.indicesByWay.get(way.id) ?? []) {
    if (index > 0 && index < way.points.length - 1) indices.add(index);
  }
  const vertices = [...indices]
    .sort((a, b) => a - b)
    .map((index) => ({
      index,
      key: nodeReferences.keyByWayPoint.get(`${way.id}:${index}`) ?? `end:${way.id}:${index}`,
    }));
  wayVertices.set(way.id, vertices);
  for (const vertex of vertices) {
    if (!vertexSeed.has(vertex.key)) vertexSeed.set(vertex.key, way.points[vertex.index]);
  }
}

function diagramEdges(wayVertices: ReadonlyMap<string, readonly WayVertex[]>): DiagramRouteEdge[] {
  const edges: DiagramRouteEdge[] = [];
  for (const vertices of wayVertices.values()) {
    for (let index = 0; index < vertices.length - 1; index += 1) {
      const from = vertices[index];
      const to = vertices[index + 1];
      if (from.key !== to.key) edges.push({ a: from.key, b: to.key });
    }
  }
  return edges;
}

function diagramOrigin(vertexSeed: ReadonlyMap<string, LngLat>): LngLat {
  let sumLng = 0;
  let sumLat = 0;
  for (const c of vertexSeed.values()) {
    sumLng += c[0];
    sumLat += c[1];
  }
  return [sumLng / vertexSeed.size, sumLat / vertexSeed.size];
}

function relaxDiagramGraph(graph: DiagramGraph): Map<string, LngLat> {
  const finalCoordinates = new Map<string, LngLat>();
  for (const component of diagramComponents(graph)) {
    const componentOrigin = diagramOrigin(component.vertexSeed);
    for (const [key, coordinate] of relaxDiagramComponent(component, componentOrigin)) {
      finalCoordinates.set(key, coordinate);
    }
  }
  return finalCoordinates;
}

function diagramComponents(graph: DiagramGraph): DiagramComponent[] {
  const adjacentEdges = diagramAdjacency(graph.edges);
  const unvisited = new Set(graph.vertexSeed.keys());
  const components: DiagramComponent[] = [];
  for (const first of [...unvisited]) {
    if (!unvisited.delete(first)) continue;
    components.push(collectDiagramComponent(first, unvisited, adjacentEdges, graph.vertexSeed));
  }
  return components;
}

function diagramAdjacency(
  edges: readonly DiagramRouteEdge[],
): ReadonlyMap<string, readonly DiagramRouteEdge[]> {
  const adjacentEdges = new Map<string, DiagramRouteEdge[]>();
  for (const edge of edges) {
    addAdjacentEdge(adjacentEdges, edge.a, edge);
    addAdjacentEdge(adjacentEdges, edge.b, edge);
  }
  return adjacentEdges;
}

function collectDiagramComponent(
  first: string,
  unvisited: Set<string>,
  adjacentEdges: ReadonlyMap<string, readonly DiagramRouteEdge[]>,
  allSeeds: ReadonlyMap<string, LngLat>,
): DiagramComponent {
  const keys = new Set<string>([first]);
  const edges = new Set<DiagramRouteEdge>();
  const queue = [first];
  for (const key of queue) {
    for (const edge of adjacentEdges.get(key) ?? []) {
      edges.add(edge);
      const neighbor = edge.a === key ? edge.b : edge.a;
      if (unvisited.delete(neighbor)) {
        keys.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return { vertexSeed: componentSeeds(keys, allSeeds), edges: [...edges] };
}

function componentSeeds(
  keys: ReadonlySet<string>,
  allSeeds: ReadonlyMap<string, LngLat>,
): Map<string, LngLat> {
  const seeds = new Map<string, LngLat>();
  for (const key of keys) {
    const coordinate = allSeeds.get(key);
    if (!coordinate) throw new Error('Diagram component is missing a vertex seed.');
    seeds.set(key, coordinate);
  }
  return seeds;
}

function addAdjacentEdge(
  adjacentEdges: Map<string, DiagramRouteEdge[]>,
  key: string,
  edge: DiagramRouteEdge,
): void {
  const edges = adjacentEdges.get(key);
  if (edges) edges.push(edge);
  else adjacentEdges.set(key, [edge]);
}

function relaxDiagramComponent(component: DiagramComponent, origin: LngLat): Map<string, LngLat> {
  const pos = new Map<string, [number, number]>();
  for (const [key, coord] of component.vertexSeed) pos.set(key, metersFromOrigin(origin, coord));

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const edge of component.edges) {
      const a = pos.get(edge.a);
      const b = pos.get(edge.b);
      if (!a || !b) throw new Error('Diagram graph edge has no endpoint position.');
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.max(Math.hypot(dx, dy), MIN_EDGE_METERS);
      const angle = Math.round(Math.atan2(dy, dx) / ANGLE_STEP) * ANGLE_STEP;
      const midX = (a[0] + b[0]) / 2;
      const midY = (a[1] + b[1]) / 2;
      const halfX = (Math.cos(angle) * len) / 2;
      const halfY = (Math.sin(angle) * len) / 2;
      pos.set(edge.a, [a[0] + (midX - halfX - a[0]) * EASE, a[1] + (midY - halfY - a[1]) * EASE]);
      pos.set(edge.b, [b[0] + (midX + halfX - b[0]) * EASE, b[1] + (midY + halfY - b[1]) * EASE]);
    }
  }
  const finalCoord = new Map<string, LngLat>();
  for (const [key, [x, y]] of pos) finalCoord.set(key, offsetMeters(origin, x, y));
  return finalCoord;
}

function projectDiagramWays(
  ways: readonly Way[],
  wayVertices: ReadonlyMap<string, readonly WayVertex[]>,
  finalCoordinates: ReadonlyMap<string, LngLat>,
  edgeRoutes: DiagramEdgeRoutes,
): Way[] {
  return ways.map((way) => {
    const vertices = wayVertices.get(way.id);
    if (!vertices) return way;
    const points: LngLat[] = [];
    for (let index = 0; index < vertices.length - 1; index += 1) {
      const from = vertices[index];
      const to = vertices[index + 1];
      const route = edgeRoutes.get(diagramEdgeKey(from.key, to.key));
      const segment = route ?? diagramEdgeCoordinates(from, to, finalCoordinates);
      if (index === 0) points.push(segment[0]);
      points.push(...segment.slice(1));
    }
    return {
      ...way,
      points,
      geometry: 'straight',
    };
  });
}

function diagramEdgeCoordinates(
  from: WayVertex,
  to: WayVertex,
  coordinates: ReadonlyMap<string, LngLat>,
): readonly [LngLat, LngLat] {
  const start = coordinates.get(from.key);
  const end = coordinates.get(to.key);
  if (!start || !end) throw new Error('Diagram route is missing an endpoint position.');
  return [start, end];
}

function unchangedDiagramTopology(ways: Way[], nodes: Node[]): DiagramTopology {
  return {
    ways,
    nodePositions: Object.fromEntries(nodes.map((node) => [node.id, node.coord])),
    topologyRevision: diagramTopologyRevision(ways, nodes),
  };
}
