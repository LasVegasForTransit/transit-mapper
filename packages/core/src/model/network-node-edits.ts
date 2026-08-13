import { armRefKey, getComponent, laneRefKey, withComponent, withoutComponent } from './components';
import { metersFromOrigin, offsetMeters } from './geo';
import { reanchorStopsOnWay } from './stop-reanchoring';
import type {
  DrivingSide,
  LaneConnector,
  LngLat,
  Node,
  NodeControl,
  TransitSystem,
  WayPointRef,
} from './system';

const DISCONNECT_NUDGE_M = 12;

function armTangentsAt(
  system: TransitSystem,
  origin: LngLat,
  ref: WayPointRef,
): [number, number][] {
  const way = system.ways.find((candidate) => candidate.id === ref.wayId);
  if (!way) return [];

  const tangents: [number, number][] = [];
  const before = ref.pointIndex > 0 ? way.points[ref.pointIndex - 1] : undefined;
  const after = ref.pointIndex < way.points.length - 1 ? way.points[ref.pointIndex + 1] : undefined;
  for (const neighbor of [before, after]) {
    if (!neighbor) continue;
    const [dx, dy] = metersFromOrigin(origin, neighbor);
    const length = Math.hypot(dx, dy);
    if (length < 0.01) continue;
    tangents.push([dx / length, dy / length]);
  }
  return tangents;
}

function disconnectDirection(
  system: TransitSystem,
  origin: LngLat,
  staying: WayPointRef[],
  leaving: WayPointRef[],
): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const ref of staying) {
    for (const [dx, dy] of armTangentsAt(system, origin, ref)) {
      sx += dx;
      sy += dy;
    }
  }

  const length = Math.hypot(sx, sy);
  if (length > 1e-6) return [-sx / length, -sy / length];
  return leaving.flatMap((ref) => armTangentsAt(system, origin, ref))[0] ?? [1, 0];
}

function nodeWithoutWay(node: Node, wayId: string, refs: WayPointRef[]): Node {
  const connectors = node.connectors?.filter(
    (connector) => connector.from.wayId !== wayId && connector.to.wayId !== wayId,
  );
  const next: Node = { ...node, refs };
  if (connectors && connectors.length > 0) next.connectors = connectors;
  else delete next.connectors;
  return next;
}

/**
 * Removes one way from a junction and moves its shared control point 12 m
 * clear. Merely dropping the ref would leave coincident geometry that document
 * repair recognizes as the same junction on the next load.
 */
export function disconnectNodeWay(
  system: TransitSystem,
  nodeId: string,
  wayId: string,
): TransitSystem {
  const node = system.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return system;

  const leaving = node.refs.filter((ref) => ref.wayId === wayId);
  if (leaving.length === 0) return system;
  const staying = node.refs.filter((ref) => ref.wayId !== wayId);
  const [dx, dy] = disconnectDirection(system, node.coord, staying, leaving);
  const movedIndices = new Set(leaving.map((ref) => ref.pointIndex));
  const leavingWay = system.ways.find((way) => way.id === wayId);
  const ways = leavingWay
    ? system.ways.map((way) =>
        way === leavingWay
          ? {
              ...way,
              points: way.points.map((point, index) =>
                movedIndices.has(index)
                  ? offsetMeters(point, dx * DISCONNECT_NUDGE_M, dy * DISCONNECT_NUDGE_M)
                  : point,
              ),
            }
          : way,
      )
    : system.ways;
  const nodes =
    staying.length < 2
      ? system.nodes.filter((candidate) => candidate !== node)
      : system.nodes.map((candidate) =>
          candidate === node ? nodeWithoutWay(node, wayId, staying) : candidate,
        );
  const next = { ...system, ways, nodes };
  return { ...next, stops: reanchorStopsOnWay(next, wayId) };
}

export function setNodeControl(
  system: TransitSystem,
  nodeId: string,
  control: NodeControl | undefined,
): TransitSystem {
  const node = system.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.control === control) return system;

  const nextNode = { ...node, control };
  if (control === undefined) delete nextNode.control;
  const nodes = system.nodes.map((candidate) => (candidate === node ? nextNode : candidate));
  return { ...system, nodes };
}

function sameConnectors(
  left: LaneConnector[] | undefined,
  right: LaneConnector[] | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return (
    left.length === right.length &&
    left.every(
      (connector, index) =>
        connector.from.wayId === right[index].from.wayId &&
        connector.from.laneId === right[index].from.laneId &&
        connector.to.wayId === right[index].to.wayId &&
        connector.to.laneId === right[index].to.laneId,
    )
  );
}

export function setNodeConnectors(
  system: TransitSystem,
  nodeId: string,
  connectors: LaneConnector[] | undefined,
): TransitSystem {
  const node = system.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || sameConnectors(node.connectors, connectors)) return system;

  const nextNode = { ...node, connectors };
  if (connectors === undefined) delete nextNode.connectors;
  const nodes = system.nodes.map((candidate) => (candidate === node ? nextNode : candidate));
  return { ...system, nodes };
}

export function setApproachControl(
  system: TransitSystem,
  wayId: string,
  end: 'start' | 'end',
  control: NodeControl | undefined,
): TransitSystem {
  const key = armRefKey(wayId, end);
  const current = getComponent(system.approachControls, key);
  if (current?.control === control) return system;

  const approachControls =
    control === undefined
      ? withoutComponent(system.approachControls, key)
      : withComponent(system.approachControls, key, { control });
  return { ...system, approachControls };
}

function sameTargetSet(left: string[], right: string[]): boolean {
  const leftTargets = new Set(left);
  const rightTargets = new Set(right);
  return (
    leftTargets.size === rightTargets.size && [...leftTargets].every((id) => rightTargets.has(id))
  );
}

export function setTurnRestriction(
  system: TransitSystem,
  wayId: string,
  laneId: string,
  allowedTargets: string[] | undefined,
): TransitSystem {
  const key = laneRefKey(wayId, laneId);
  const current = getComponent(system.turnRestrictions, key);
  if (allowedTargets === undefined) {
    if (current === undefined) return system;
    const turnRestrictions = withoutComponent(system.turnRestrictions, key);
    return { ...system, turnRestrictions };
  }
  if (current !== undefined && sameTargetSet(current.allowedTargets, allowedTargets)) return system;

  const turnRestrictions = withComponent(system.turnRestrictions, key, { allowedTargets });
  return { ...system, turnRestrictions };
}

export function setDrivingSide(system: TransitSystem, side: DrivingSide): TransitSystem {
  return system.drivingSide === side ? system : { ...system, drivingSide: side };
}
