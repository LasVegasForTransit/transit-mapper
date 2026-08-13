// The "Diagram" view mode's layout engine: turns real-world way geometry into
// a Tube-map-style schematic with every edge snapped to a multiple of 45°.
// Heuristic, not a constraint solver (per the plan's own framing) — seed each
// graph vertex at its real position, then iteratively ease every edge toward
// its nearest 45° direction. Good enough for a hobbyist network; a system
// with many conflicting junctions won't converge to something perfectly
// clean, but it never crashes or produces degenerate (zero-length/NaN)
// geometry, and it always preserves real topology (shared junctions stay
// coincident, nothing crosses that wasn't already crossing).
//
// This never touches the real system — every consumer (buildFeatures, camera
// framing) is handed a derived, transient TransitSystem for rendering only.
// Pure/serializable in-out and DOM/store-free like routeGraph.ts — safe to
// move to a Web Worker or run server-side later if the relaxation solver
// ever needs to run on a system too large to iterate 60 times synchronously
// on the main thread.
import { metersFromOrigin, offsetMeters, pointAtT, primaryAnchor, resolveWayPath } from './geo';
import type { LngLat, Node, Stop, TransitSystem, Way } from './system';

export interface DiagramLayoutOperationCounts {
  diagramTopologyBuildCount: number;
  diagramTopologyCacheHitCount: number;
  diagramStopBuildCount: number;
  diagramStopCacheHitCount: number;
}

const topologyCache = new WeakMap<Way[], WeakMap<Node[], Way[]>>();
const stopCache = new WeakMap<Stop[], WeakMap<Way[], Stop[]>>();
const systemCache = new WeakMap<TransitSystem, TransitSystem>();

/** The schematic-layout projection of `system`, memoized by the immutable
 * collections each stage actually reads. A facility/service/meta edit creates
 * a new TransitSystem wrapper but keeps `ways` and `nodes`; it must not rerun
 * sixty relaxation passes. Stop placement is cached separately so a stop
 * edit remaps stops onto the already-schematic ways without rebuilding the
 * topology. */
export function computeDiagramSystem(
  system: TransitSystem,
  counts?: DiagramLayoutOperationCounts,
): TransitSystem {
  const cached = systemCache.get(system);
  if (cached) return cached;
  const ways = diagramWaysFor(system.ways, system.nodes, counts);
  const stops = ways === system.ways ? system.stops : diagramStopsFor(system.stops, ways, counts);
  const projected =
    ways === system.ways && stops === system.stops ? system : { ...system, ways, stops };
  systemCache.set(system, projected);
  return projected;
}

interface WayVertex {
  /** Index into the original way.points array. */
  index: number;
  /** "node:<id>" for a real junction, "end:<wayId>:<index>" for a dead end —
   *  shared across ways only when it's a genuine Node. */
  key: string;
}

const DIRECTIONS = 8;
const ANGLE_STEP = (2 * Math.PI) / DIRECTIONS;
const ITERATIONS = 60;
const EASE = 0.35;
const MIN_EDGE_METERS = 10; // numerical floor only, not a stylistic minimum

function diagramWaysFor(ways: Way[], nodes: Node[], counts?: DiagramLayoutOperationCounts): Way[] {
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

function buildDiagramWays(ways: Way[], nodes: Node[]): Way[] {
  if (ways.length === 0) return ways;

  // One pass over system.nodes instead of scanning it once per way to find
  // junction indices AND again per vertex to resolve each one's node key —
  // memoized by system reference (computeDiagramSystem above), so this only
  // reruns once per actual content edit while Diagram view is active, but
  // each edit still paid the double O(ways × nodes) scan this replaces.
  const nodeKeyByWayPoint = new Map<string, string>(); // "wayId:index" -> "node:<id>"
  const nodeIndicesByWay = new Map<string, number[]>();
  for (const node of nodes) {
    for (const ref of node.refs) {
      nodeKeyByWayPoint.set(`${ref.wayId}:${ref.pointIndex}`, `node:${node.id}`);
      const list = nodeIndicesByWay.get(ref.wayId);
      if (list) list.push(ref.pointIndex);
      else nodeIndicesByWay.set(ref.wayId, [ref.pointIndex]);
    }
  }

  // Every way's own ordered vertex list: its two ends, plus any interior
  // point that's a real junction with another way (see joinWayPointToWay —
  // a mid-way join splices a genuine control point in, it isn't always at an
  // endpoint).
  const wayVertices = new Map<string, WayVertex[]>();
  const vertexSeed = new Map<string, LngLat>();

  for (const way of ways) {
    if (way.points.length < 2) continue;
    const indices = new Set<number>([0, way.points.length - 1]);
    for (const index of nodeIndicesByWay.get(way.id) ?? []) {
      if (index > 0 && index < way.points.length - 1) indices.add(index);
    }
    const vertices = [...indices]
      .sort((a, b) => a - b)
      .map((index) => ({
        index,
        key: nodeKeyByWayPoint.get(`${way.id}:${index}`) ?? `end:${way.id}:${index}`,
      }));
    wayVertices.set(way.id, vertices);
    for (const v of vertices) {
      if (!vertexSeed.has(v.key)) vertexSeed.set(v.key, way.points[v.index]);
    }
  }

  if (vertexSeed.size === 0) return ways;

  // Project every seed into local planar meters around the graph's centroid.
  let sumLng = 0;
  let sumLat = 0;
  for (const c of vertexSeed.values()) {
    sumLng += c[0];
    sumLat += c[1];
  }
  const origin: LngLat = [sumLng / vertexSeed.size, sumLat / vertexSeed.size];

  const pos = new Map<string, [number, number]>();
  for (const [key, coord] of vertexSeed) pos.set(key, metersFromOrigin(origin, coord));

  interface Edge {
    a: string;
    b: string;
  }
  const edges: Edge[] = [];
  for (const vertices of wayVertices.values()) {
    for (let i = 0; i < vertices.length - 1; i++) {
      if (vertices[i].key !== vertices[i + 1].key)
        edges.push({ a: vertices[i].key, b: vertices[i + 1].key });
    }
  }

  // Snap-then-relax: each iteration eases every edge's endpoints toward the
  // positions that would make it exactly the nearest 45°-multiple direction,
  // keeping its current length and midpoint. A vertex shared by several edges
  // (a junction) gets pulled toward each edge's target in turn, so it settles
  // somewhere between them rather than any one edge "winning" outright.
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const edge of edges) {
      const a = pos.get(edge.a)!;
      const b = pos.get(edge.b)!;
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

  return ways.map((way) => {
    const vertices = wayVertices.get(way.id);
    if (!vertices) return way;
    return {
      ...way,
      points: vertices.map((v) => finalCoord.get(v.key) ?? way.points[v.index]),
      geometry: 'straight',
    };
  });
}

function diagramStopsFor(
  stops: Stop[],
  ways: Way[],
  counts?: DiagramLayoutOperationCounts,
): Stop[] {
  let byWays = stopCache.get(stops);
  if (!byWays) {
    byWays = new WeakMap();
    stopCache.set(stops, byWays);
  }
  const cached = byWays.get(ways);
  if (cached) {
    if (counts) counts.diagramStopCacheHitCount++;
    return cached;
  }
  if (counts) counts.diagramStopBuildCount++;
  const waysById = new Map(ways.map((way) => [way.id, way]));
  const projected = stops.map((st) => {
    // The FIRST anchor: a stop on two ways is moved by the alignment it
    // was primarily placed on, not by whichever happens to be iterated first.
    const anchor = primaryAnchor(st);
    if (!anchor) return st;
    const way = waysById.get(anchor.wayId);
    if (!way || way.points.length < 2) return st;
    // A stop's t is a fraction of the way's RESOLVED path — that is what
    // anchoring measured it against — so that is the ruler to place it with.
    //
    // No stop moves today: the schematic ways this walks are rebuilt as
    // `straight` above, and resolveWayPath returns the points unchanged for
    // those. It is written this way so it stays correct if the schematic ever
    // keeps a way's own geometry, where the resolved path is longer than the
    // polyline through its vertices and every stop would sit early.
    return { ...st, coord: pointAtT(resolveWayPath(way), anchor.t) };
  });
  byWays.set(ways, projected);
  return projected;
}
