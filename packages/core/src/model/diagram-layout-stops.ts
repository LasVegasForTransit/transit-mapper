/**
 * Stop placement for Diagram. Stops retain their document anchors; this
 * module reapplies those anchors to the routed schematic ways.
 */
import { pointAtT, primaryAnchor, resolveWayPath } from './geo';
import type { Stop, Way } from './system';

export interface DiagramStopPlacementOperationCounts {
  diagramStopBuildCount: number;
  diagramStopCacheHitCount: number;
}

const stopCache = new WeakMap<Stop[], WeakMap<Way[], Stop[]>>();

export function diagramStopsFor(
  stops: Stop[],
  ways: Way[],
  counts?: DiagramStopPlacementOperationCounts,
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
  const projected = stops.map((stop) => {
    // The first anchor expresses the stop's primary alignment; additional
    // anchors preserve shared-platform membership but do not move it twice.
    const anchor = primaryAnchor(stop);
    if (!anchor) return stop;
    const way = waysById.get(anchor.wayId);
    if (!way || way.points.length < 2) return stop;
    return { ...stop, coord: pointAtT(resolveWayPath(way), anchor.t) };
  });
  byWays.set(ways, projected);
  return projected;
}
