/** Deterministic content identity for a Diagram topology. The revision is
 * intentionally based on geometry and junction membership, not document
 * metadata, so presentation-only edits do not invalidate layout work. */
import type { LngLat, Node, Way } from './system';

/** Keeps the document's explicit junction entities in the same coordinate
 * system as the routed schematic ways. */
export function diagramNodePositions(
  nodes: readonly Node[],
  finalCoordinates: ReadonlyMap<string, LngLat>,
): Readonly<Record<string, LngLat>> {
  return Object.fromEntries(
    nodes.map((node) => [node.id, finalCoordinates.get(`node:${node.id}`) ?? node.coord]),
  );
}

export function diagramNodesFor(
  nodes: Node[],
  nodePositions: Readonly<Record<string, LngLat>>,
): Node[] {
  const projected = nodes.map((node) => {
    const coord = nodePositions[node.id] ?? node.coord;
    if (coord === node.coord || (coord[0] === node.coord[0] && coord[1] === node.coord[1])) {
      return node;
    }
    return { ...node, coord };
  });
  return projected.some((node, index) => node !== nodes[index]) ? projected : nodes;
}

export function diagramTopologyRevision(ways: readonly Way[], nodes: readonly Node[]): string {
  let hash = 2_166_136_261;
  const append = (value: string | number) => {
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
  };
  for (const way of ways) {
    append(way.id);
    for (const point of way.points) {
      append(point[0]);
      append(point[1]);
    }
  }
  for (const node of nodes) {
    append(node.id);
    for (const ref of node.refs) {
      append(ref.wayId);
      append(ref.pointIndex);
    }
  }
  return `diagram-${(hash >>> 0).toString(36)}`;
}
