/**
 * Routing for octilinear Diagram edges after the topology solver has placed
 * their endpoints. This is separate from graph relaxation because crossing
 * avoidance changes an edge's drawn path, never its topological endpoints.
 */
import { metersFromOrigin, offsetMeters } from './geo';
import type { LngLat } from './system';

export interface DiagramRouteEdge {
  readonly a: string;
  readonly b: string;
}

export type DiagramEdgeRoutes = ReadonlyMap<string, readonly LngLat[]>;

interface DiagramSegment {
  readonly start: readonly [number, number];
  readonly end: readonly [number, number];
}

interface DiagramRouteContext {
  readonly geographicCoordinates: ReadonlyMap<string, LngLat>;
  readonly finalCoordinates: ReadonlyMap<string, LngLat>;
  readonly origin: LngLat;
}

/**
 * Adds short, deterministic doglegs only when snapping creates a crossing
 * absent from the geographic document. Existing crossings stay untouched so
 * grade/control rendering can describe them correctly.
 */
export function detouredDiagramRoutes(
  edges: readonly DiagramRouteEdge[],
  geographicCoordinates: ReadonlyMap<string, LngLat>,
  finalCoordinates: ReadonlyMap<string, LngLat>,
): DiagramEdgeRoutes {
  const context: DiagramRouteContext = {
    geographicCoordinates,
    finalCoordinates,
    origin: diagramOrigin(finalCoordinates),
  };
  const routes = new Map<string, readonly LngLat[]>();
  const detoured = new Set<string>();
  for (let firstIndex = 0; firstIndex < edges.length - 1; firstIndex += 1) {
    const first = edges[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < edges.length; secondIndex += 1) {
      const second = edges[secondIndex];
      const chosen = detourForIntroducedCrossing(first, second, context);
      if (!chosen || detoured.has(diagramEdgeKey(chosen.a, chosen.b))) continue;
      const crossing = finalCrossing(first, second, context);
      if (!crossing) continue;
      const segment = localEdgeSegment(chosen, context.finalCoordinates, context.origin);
      routes.set(
        diagramEdgeKey(chosen.a, chosen.b),
        detouredRoute(chosen, segment, crossing, context.origin),
      );
      detoured.add(diagramEdgeKey(chosen.a, chosen.b));
    }
  }
  return routesWithDistinctJunctionPorts(edges, routes, finalCoordinates);
}

const PORT_STEP = Math.PI / 4;
const MAX_PORT_STUB_METERS = 12;

/**
 * A schematic junction must not send several coincident branches through one
 * visual exit. We reserve one of the eight octilinear directions for every
 * real junction arm, retaining the geography-derived direction whenever it
 * is available. Stable edge-key ties make deliberately coincident imports
 * readable instead of leaving their draw order to decide which branch wins.
 *
 * Termini do not need a port: a short stub there would invent a turn where
 * the document records a simple end point.
 */
function routesWithDistinctJunctionPorts(
  edges: readonly DiagramRouteEdge[],
  detours: DiagramEdgeRoutes,
  coordinates: ReadonlyMap<string, LngLat>,
): DiagramEdgeRoutes {
  const assignments = junctionPortAssignments(edges, coordinates);
  if (assignments.size === 0) return detours;

  const routes = new Map(detours);
  for (const edge of edges) {
    const key = diagramEdgeKey(edge.a, edge.b);
    const start = coordinates.get(edge.a);
    const end = coordinates.get(edge.b);
    if (!start || !end) throw new Error('Diagram route is missing an endpoint position.');
    const startPort = assignments.get(portKey(edge, edge.a));
    const endPort = assignments.get(portKey(edge, edge.b));
    if (startPort === undefined && endPort === undefined) continue;

    const route = detours.get(key) ?? [start, end];
    const points: LngLat[] = [start];
    if (startPort !== undefined) points.push(portStub(start, end, startPort));
    points.push(...route.slice(1, -1));
    if (endPort !== undefined) points.push(portStub(end, start, endPort));
    points.push(end);
    routes.set(key, points);
  }
  return routes;
}

function junctionPortAssignments(
  edges: readonly DiagramRouteEdge[],
  coordinates: ReadonlyMap<string, LngLat>,
): ReadonlyMap<string, number> {
  const incidentByVertex = new Map<string, DiagramRouteEdge[]>();
  for (const edge of edges) {
    appendIncidentEdge(incidentByVertex, edge.a, edge);
    appendIncidentEdge(incidentByVertex, edge.b, edge);
  }

  const assignments = new Map<string, number>();
  for (const [vertex, incident] of incidentByVertex) {
    if (!vertex.startsWith('node:') || incident.length < 2) continue;
    const origin = coordinates.get(vertex);
    if (!origin) throw new Error('Diagram junction is missing its position.');
    const ordered = incident
      .map((edge) => ({ edge, preferred: preferredPort(edge, vertex, origin, coordinates) }))
      .sort(
        (left, right) =>
          left.preferred - right.preferred ||
          diagramEdgeKey(left.edge.a, left.edge.b).localeCompare(
            diagramEdgeKey(right.edge.a, right.edge.b),
          ),
      );
    const used = new Set<number>();
    for (const candidate of ordered) {
      const port = closestAvailablePort(candidate.preferred, used);
      used.add(port);
      assignments.set(portKey(candidate.edge, vertex), port);
    }
  }
  return assignments;
}

function appendIncidentEdge(
  incidentByVertex: Map<string, DiagramRouteEdge[]>,
  vertex: string,
  edge: DiagramRouteEdge,
): void {
  const incident = incidentByVertex.get(vertex);
  if (incident) incident.push(edge);
  else incidentByVertex.set(vertex, [edge]);
}

function preferredPort(
  edge: DiagramRouteEdge,
  vertex: string,
  origin: LngLat,
  coordinates: ReadonlyMap<string, LngLat>,
): number {
  const neighbor = coordinates.get(edge.a === vertex ? edge.b : edge.a);
  if (!neighbor) throw new Error('Diagram junction arm is missing its endpoint position.');
  const [x, y] = metersFromOrigin(origin, neighbor);
  const angle = Math.atan2(y, x);
  return positiveModulo(Math.round(angle / PORT_STEP), 8);
}

function closestAvailablePort(preferred: number, used: ReadonlySet<number>): number {
  const candidates = Array.from({ length: 8 }, (_, index) => index).sort(
    (left, right) =>
      circularDistance(left, preferred) - circularDistance(right, preferred) || left - right,
  );
  return candidates.find((candidate) => !used.has(candidate)) ?? preferred;
}

function circularDistance(left: number, right: number): number {
  return Math.min(positiveModulo(left - right, 8), positiveModulo(right - left, 8));
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function portStub(origin: LngLat, neighbor: LngLat, port: number): LngLat {
  const [x, y] = metersFromOrigin(origin, neighbor);
  const distance = Math.hypot(x, y);
  const length = Math.min(MAX_PORT_STUB_METERS, Math.max(2, distance * 0.2));
  const angle = port * PORT_STEP;
  return offsetMeters(origin, Math.cos(angle) * length, Math.sin(angle) * length);
}

function portKey(edge: DiagramRouteEdge, vertex: string): string {
  return `${diagramEdgeKey(edge.a, edge.b)}|${vertex}`;
}

function detourForIntroducedCrossing(
  first: DiagramRouteEdge,
  second: DiagramRouteEdge,
  context: DiagramRouteContext,
): DiagramRouteEdge | null {
  if (sharesDiagramEndpoint(first, second) || !finalCrossing(first, second, context)) return null;
  const geographicCrossing = strictSegmentIntersection(
    localEdgeSegment(first, context.geographicCoordinates, context.origin),
    localEdgeSegment(second, context.geographicCoordinates, context.origin),
  );
  if (geographicCrossing) return null;
  return diagramEdgeKey(first.a, first.b) < diagramEdgeKey(second.a, second.b) ? second : first;
}

function finalCrossing(
  first: DiagramRouteEdge,
  second: DiagramRouteEdge,
  context: DiagramRouteContext,
): readonly [number, number] | null {
  return strictSegmentIntersection(
    localEdgeSegment(first, context.finalCoordinates, context.origin),
    localEdgeSegment(second, context.finalCoordinates, context.origin),
  );
}

function sharesDiagramEndpoint(first: DiagramRouteEdge, second: DiagramRouteEdge): boolean {
  return (
    first.a === second.a || first.a === second.b || first.b === second.a || first.b === second.b
  );
}

function localEdgeSegment(
  edge: DiagramRouteEdge,
  coordinates: ReadonlyMap<string, LngLat>,
  origin: LngLat,
): DiagramSegment {
  const start = coordinates.get(edge.a);
  const end = coordinates.get(edge.b);
  if (!start || !end) throw new Error('Diagram edge is missing a coordinate.');
  return { start: metersFromOrigin(origin, start), end: metersFromOrigin(origin, end) };
}

function strictSegmentIntersection(
  first: DiagramSegment,
  second: DiagramSegment,
): readonly [number, number] | null {
  const firstX = first.end[0] - first.start[0];
  const firstY = first.end[1] - first.start[1];
  const secondX = second.end[0] - second.start[0];
  const secondY = second.end[1] - second.start[1];
  const denominator = firstX * secondY - firstY * secondX;
  if (Math.abs(denominator) < 0.001) return null;
  const relativeX = second.start[0] - first.start[0];
  const relativeY = second.start[1] - first.start[1];
  const firstT = (relativeX * secondY - relativeY * secondX) / denominator;
  const secondT = (relativeX * firstY - relativeY * firstX) / denominator;
  if (firstT <= 0 || firstT >= 1 || secondT <= 0 || secondT >= 1) return null;
  return [first.start[0] + firstT * firstX, first.start[1] + firstT * firstY];
}

function detouredRoute(
  edge: DiagramRouteEdge,
  segment: DiagramSegment,
  crossing: readonly [number, number],
  origin: LngLat,
): readonly LngLat[] {
  const x = segment.end[0] - segment.start[0];
  const y = segment.end[1] - segment.start[1];
  const length = Math.hypot(x, y);
  const run = Math.min(40, length * 0.25);
  const offset = Math.min(18, length * 0.2) * diagramDetourSide(edge);
  const unitX = x / length;
  const unitY = y / length;
  const normalX = -unitY * offset;
  const normalY = unitX * offset;
  return [
    offsetMeters(origin, segment.start[0], segment.start[1]),
    offsetMeters(origin, crossing[0] - unitX * run + normalX, crossing[1] - unitY * run + normalY),
    offsetMeters(origin, crossing[0] + unitX * run + normalX, crossing[1] + unitY * run + normalY),
    offsetMeters(origin, segment.end[0], segment.end[1]),
  ];
}

function diagramOrigin(coordinates: ReadonlyMap<string, LngLat>): LngLat {
  let sumLng = 0;
  let sumLat = 0;
  for (const coordinate of coordinates.values()) {
    sumLng += coordinate[0];
    sumLat += coordinate[1];
  }
  return [sumLng / coordinates.size, sumLat / coordinates.size];
}

function diagramDetourSide(edge: DiagramRouteEdge): -1 | 1 {
  let hash = 0;
  for (const character of diagramEdgeKey(edge.a, edge.b)) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return hash & 1 ? 1 : -1;
}

export function diagramEdgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}
