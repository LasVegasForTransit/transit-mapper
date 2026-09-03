import { armRefKey, getComponent, laneRefKey } from '../../model/components';
import type { LaneSpec, Node, TransitSystem, Way } from '../../model/system';
import type {
  ResolvedApproachControl,
  ResolvedInfrastructureChunk,
  ResolvedTurnRestriction,
} from '../resolved-network-chunk';
import { legacyDerivedId } from './identity';

type WayEnd = 'start' | 'end';
type EndpointNodeIndex = ReadonlyMap<string, readonly Node[]>;

function addEndpointNode(index: Map<string, Node[]>, key: string, node: Node): void {
  const nodes = index.get(key);
  if (nodes) nodes.push(node);
  else index.set(key, [node]);
}

function endpointNodeIndex(system: TransitSystem, nodes: readonly Node[]): EndpointNodeIndex {
  const pointCounts = new Map(system.ways.map((way) => [way.id, way.points.length]));
  const index = new Map<string, Node[]>();
  for (const node of nodes) {
    for (const reference of node.refs) {
      const pointCount = pointCounts.get(reference.wayId);
      if (pointCount === undefined) continue;
      if (reference.pointIndex === 0)
        addEndpointNode(index, armRefKey(reference.wayId, 'start'), node);
      if (reference.pointIndex === pointCount - 1)
        addEndpointNode(index, armRefKey(reference.wayId, 'end'), node);
    }
  }
  return index;
}

function mapApproachControls(
  system: TransitSystem,
  includedWayIds: ReadonlySet<string>,
  nodesByArm: EndpointNodeIndex,
): ResolvedApproachControl[] {
  const controls: ResolvedApproachControl[] = [];
  for (const way of system.ways) {
    if (!includedWayIds.has(way.id)) continue;
    for (const end of ['start', 'end'] as const) {
      const key = armRefKey(way.id, end);
      const control = getComponent(system.approachControls, key);
      if (!control) continue;
      for (const node of nodesByArm.get(key) ?? []) {
        controls.push({
          id: legacyDerivedId('approach-control', node.id, way.id, end),
          nodeId: node.id,
          wayId: way.id,
          end,
          controlId: control.control,
        });
      }
    }
  }
  return controls;
}

function laneApproachEnds(direction: LaneSpec['direction']): readonly WayEnd[] {
  if (direction === 'forward') return ['end'];
  if (direction === 'backward') return ['start'];
  if (direction === 'both') return ['start', 'end'];
  return [];
}

function connectedTargetWayIds(
  node: Node,
  fromWayId: string,
  includedWayIds: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      node.refs
        .map(({ wayId }) => wayId)
        .filter((wayId) => wayId !== fromWayId && includedWayIds.has(wayId)),
    ),
  ];
}

interface TurnRestrictionContext {
  system: TransitSystem;
  includedWayIds: ReadonlySet<string>;
  nodesByArm: EndpointNodeIndex;
  way: Way;
}

function laneTurnRestrictions(
  context: TurnRestrictionContext,
  lane: LaneSpec,
): ResolvedTurnRestriction[] {
  const restriction = getComponent(
    context.system.turnRestrictions,
    laneRefKey(context.way.id, lane.id),
  );
  if (!restriction) return [];
  const allowedTargets = new Set(restriction.allowedTargets);
  return laneApproachEnds(lane.direction).flatMap((end) =>
    (context.nodesByArm.get(armRefKey(context.way.id, end)) ?? []).flatMap((node) =>
      connectedTargetWayIds(node, context.way.id, context.includedWayIds).flatMap((targetWayId) =>
        allowedTargets.has(targetWayId)
          ? []
          : [
              {
                id: legacyDerivedId(
                  'turn-restriction',
                  context.way.id,
                  lane.id,
                  node.id,
                  targetWayId,
                ),
                from: {
                  wayId: context.way.id,
                  laneIds: { kind: 'only', values: [lane.id] },
                },
                to: { wayId: targetWayId, laneIds: { kind: 'all' } },
                via: { kind: 'node', nodeId: node.id },
                movement: 'prohibited' as const,
                modeIds: { kind: 'unknown' as const },
              },
            ],
      ),
    ),
  );
}

function mapTurnRestrictions(
  system: TransitSystem,
  includedWayIds: ReadonlySet<string>,
  nodesByArm: EndpointNodeIndex,
): ResolvedTurnRestriction[] {
  const restrictions: ResolvedTurnRestriction[] = [];
  for (const way of system.ways) {
    if (!includedWayIds.has(way.id)) continue;
    for (const lane of way.profile.lanes) {
      restrictions.push(...laneTurnRestrictions({ system, includedWayIds, nodesByArm, way }, lane));
    }
  }
  return restrictions;
}

export function mapInfrastructureControls(
  system: TransitSystem,
  nodes: readonly Node[],
  includedWayIds: ReadonlySet<string>,
): Pick<ResolvedInfrastructureChunk, 'approachControls' | 'turnRestrictions'> {
  const nodesByArm = endpointNodeIndex(system, nodes);
  return {
    turnRestrictions: mapTurnRestrictions(system, includedWayIds, nodesByArm),
    approachControls: mapApproachControls(system, includedWayIds, nodesByArm),
  };
}
