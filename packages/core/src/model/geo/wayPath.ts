import type { LngLat, Node, Way } from '../system';
import { resolveMetricCenterline, tessellateMetricCenterline } from '../../geometry/metric-curves';

// This is deliberately a model-quality default, not a screen-space policy.
// Renderers that know their final presentation can ask for a coarser or finer
// path through `resolveWayPathAtError`; editing, snapping, and routing need a
// stable physical path even when no camera exists.
const DEFAULT_CURVE_SAGITTA_M = 0.25;
// Core transforms preserve unchanged Way references, so this reference-keyed
// cache needs no invalidation. This matters:
// buildFeatures() calls resolveWayPath for every way (and, per stop, for
// every way again via servedWayIds) on every rebuild — during a drag that's
// once per animation frame, and without this cache it was once per raw
// mousemove event, recomputing curve geometry for the entire system each time.
const wayPathCache = new WeakMap<Way, Map<number, LngLat[]>>();

/**
 * The stable physical path used by model operations that have no camera.
 * Curved ways use tangent-continuous metric arcs; straight and freeform ways
 * retain their authored control-point references.
 */
export function resolveWayPath(way: Way): LngLat[] {
  return resolveWayPathAtError(way, DEFAULT_CURVE_SAGITTA_M);
}

/** Resolves a physical path with no chord deviating more than `maxSagittaM`
 * from a curved way's metric centerline. */
export function resolveWayPathAtError(way: Way, maxSagittaM: number): LngLat[] {
  if (way.geometry !== 'curved' || way.points.length < 3) return way.points;
  let pathsByError = wayPathCache.get(way);
  if (!pathsByError) {
    pathsByError = new Map();
    wayPathCache.set(way, pathsByError);
  }
  const cached = pathsByError.get(maxSagittaM);
  if (cached) return cached;
  const path = tessellateMetricCenterline(
    resolveMetricCenterline(way.points, { curveControls: way.curveControls }),
    maxSagittaM,
  );
  pathsByError.set(maxSagittaM, path);
  return path;
}

/**
 * Round an arbitrary coordinate polyline with local quadratic corners.
 *
 * This remains a small, coordinate-space helper for callers that do not have
 * a physical Way. Way rendering deliberately does not use it: curved Ways
 * resolve metric, tangent-continuous arcs above. Keeping the two names makes
 * that distinction visible instead of silently applying a degree-space curve
 * to real infrastructure.
 */
export function roundedCorners(
  points: LngLat[],
  cornerFraction: number,
  samples: number,
): LngLat[] {
  if (points.length < 3) return points;
  const path: LngLat[] = [points[0]];
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const previousDistance = Math.hypot(corner[0] - previous[0], corner[1] - previous[1]);
    const nextDistance = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
    const radius = Math.min(previousDistance, nextDistance) * cornerFraction;
    if (radius < 1e-12) {
      path.push(corner);
      continue;
    }
    const entering = interpolate(corner, previous, radius / previousDistance);
    const leaving = interpolate(corner, next, radius / nextDistance);
    path.push(entering);
    for (let step = 1; step <= samples; step++) {
      const t = step / samples;
      const inverse = 1 - t;
      path.push([
        inverse * inverse * entering[0] + 2 * inverse * t * corner[0] + t * t * leaving[0],
        inverse * inverse * entering[1] + 2 * inverse * t * corner[1] + t * t * leaving[1],
      ]);
    }
  }
  path.push(points[points.length - 1]);
  return path;
}

function interpolate(from: LngLat, to: LngLat, fraction: number): LngLat {
  return [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction];
}

// Cached by the ways array's own reference (immutable-replacement
// convention, same as wayPathCache) — patternPath runs on every animation
// frame for every pattern (see map/vehicles.ts), so a linear ways.find per
// wayId adds up fast on a large imported system. Shared between servicePaths
// (patternPath) and snapIndex (snap) — both need way-by-id lookup, neither
// owns the concern more than the other, so it lives alongside the way-path
// cache it's structurally identical to.
const wayByIdCache = new WeakMap<Way[], Map<string, Way>>();

export function wayById(ways: Way[]): Map<string, Way> {
  let index = wayByIdCache.get(ways);
  if (index) return index;
  // Avoid intermediate array allocation from ways.map(); build Map directly.
  index = new Map<string, Way>();
  for (const w of ways) {
    index.set(w.id, w);
  }
  wayByIdCache.set(ways, index);
  return index;
}

// Cached by the nodes array's own reference, same convention as wayById
// above — every Node[]-by-wayId consumer otherwise re-scans every Node in
// the system per lookup. Deliberately NOT shared with routeGraph.ts's own
// topologyIndexes: that cache builds a *point-index* map (wayId -> raw
// control-point indexes) in the same single pass as three other maps its
// Dijkstra core needs, and is keyed on the (ways, nodes) pair together —
// deriving it from this Node-object map would add a re-filter step to a
// pathfinding hot path for no real gain. This is the general-purpose form
// for anything that needs the actual Node objects touching a way.
const nodesByWayIdCache = new WeakMap<Node[], Map<string, Node[]>>();

export function nodesByWayId(nodes: Node[]): Map<string, Node[]> {
  let index = nodesByWayIdCache.get(nodes);
  if (index) return index;
  index = new Map();
  for (const node of nodes) {
    for (const ref of node.refs) {
      const list = index.get(ref.wayId);
      if (list) list.push(node);
      else index.set(ref.wayId, [node]);
    }
  }
  nodesByWayIdCache.set(nodes, index);
  return index;
}
