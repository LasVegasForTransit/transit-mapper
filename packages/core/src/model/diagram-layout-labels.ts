/**
 * Label anchors for the Diagram layout result.
 *
 * A NamedWay may span multiple physical way records after a corridor is split
 * at junctions or into paired carriageways. Its label therefore belongs on
 * the longest surviving schematic member, rather than on a geographic point
 * that the diagram solver has moved away from the line. Collision avoidance
 * remains a renderer concern; this module supplies the stable semantic anchor
 * that each surface can place consistently.
 */
import { metersFromOrigin, pointAtT, resolveWayPath } from './geo';
import type { LngLat, NamedWay, Way } from './system';

const anchorCache = new WeakMap<NamedWay[], WeakMap<Way[], Readonly<Record<string, LngLat>>>>();

export function diagramLabelAnchorsFor(
  namedWays: NamedWay[],
  schematicWays: Way[],
): Readonly<Record<string, LngLat>> {
  let byWays = anchorCache.get(namedWays);
  if (!byWays) {
    byWays = new WeakMap();
    anchorCache.set(namedWays, byWays);
  }
  const cached = byWays.get(schematicWays);
  if (cached) return cached;

  const waysById = new Map(schematicWays.map((way) => [way.id, way]));
  const anchors: Record<string, LngLat> = {};
  for (const namedWay of namedWays) {
    const member = longestSchematicMember(namedWay, waysById);
    if (member) anchors[namedWay.id] = pointAtT(resolveWayPath(member), 0.5);
  }
  const result = Object.freeze(anchors);
  byWays.set(schematicWays, result);
  return result;
}

function longestSchematicMember(
  namedWay: NamedWay,
  waysById: ReadonlyMap<string, Way>,
): Way | undefined {
  let longest: Way | undefined;
  let longestLength = -1;
  for (const wayId of namedWay.wayIds) {
    const way = waysById.get(wayId);
    if (!way) continue;
    const length = schematicLengthMeters(way);
    if (!longest || length > longestLength || (length === longestLength && way.id < longest.id)) {
      longest = way;
      longestLength = length;
    }
  }
  return longest;
}

function schematicLengthMeters(way: Way): number {
  const path = resolveWayPath(way);
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    const [x, y] = metersFromOrigin(path[index - 1], path[index]);
    length += Math.hypot(x, y);
  }
  return length;
}
