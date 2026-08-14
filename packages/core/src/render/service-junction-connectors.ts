/**
 * Resolves the short service-only path inside a physical junction.
 *
 * Carriageway and lane features deliberately stop at the junction footprint.
 * A through-running service needs the corresponding lane connector rather
 * than two extended lane lines that merely appear to touch at the node.
 */
import { connectorCurves, type WayTrims } from '../geometry/junctions';
import { serviceLaneOnWay } from '../model/geo';
import { legRange, patternRunLegs } from '../model/geo/servicePaths';
import type { ComponentMap } from '../model/components';
import type { LngLat, Node, PatternLeg, Service, TurnRestriction, Way } from '../model/system';

export interface ServiceJunctionConnector {
  readonly serviceId: string;
  readonly run: 'outbound' | 'inbound';
  readonly nodeId: string;
  readonly from: { readonly wayId: string; readonly laneId: string };
  readonly to: { readonly wayId: string; readonly laneId: string };
  readonly path: readonly LngLat[];
}

export interface ServiceJunctionConnectorOptions {
  readonly services: readonly Service[];
  readonly nodes: readonly Node[];
  readonly waysById: Map<string, Way>;
  readonly trims: WayTrims;
  readonly turnRestrictions: ComponentMap<TurnRestriction>;
}

export function serviceJunctionConnectors({
  services,
  nodes,
  waysById,
  trims,
  turnRestrictions,
}: ServiceJunctionConnectorOptions): readonly ServiceJunctionConnector[] {
  const endpoints = endpointNodes(nodes);
  const connectors: ServiceJunctionConnector[] = [];
  for (const service of services) {
    for (const run of ['outbound', 'inbound'] as const) {
      const legs = patternRunLegs(service.path, run);
      for (let index = 0; index < legs.length - 1; index += 1) {
        const connector = connectorForLegPair({
          service,
          run,
          legs,
          index,
          endpoints,
          waysById,
          trims,
          turnRestrictions,
        });
        if (connector) connectors.push(connector);
      }
    }
  }
  return connectors;
}

interface ConnectorForLegPairOptions {
  readonly service: Service;
  readonly run: 'outbound' | 'inbound';
  readonly legs: ReturnType<typeof patternRunLegs>;
  readonly index: number;
  readonly endpoints: ReadonlyMap<string, Node>;
  readonly waysById: Map<string, Way>;
  readonly trims: WayTrims;
  readonly turnRestrictions: ComponentMap<TurnRestriction>;
}

function connectorForLegPair({
  service,
  run,
  legs,
  index,
  endpoints,
  waysById,
  trims,
  turnRestrictions,
}: ConnectorForLegPairOptions): ServiceJunctionConnector | null {
  const from = legs[index];
  const to = legs[index + 1];
  if (!leavesAtEndpoint(from.leg, from.forward) || !entersAtEndpoint(to.leg, to.forward)) {
    return null;
  }
  const fromWay = waysById.get(from.leg.wayId);
  const toWay = waysById.get(to.leg.wayId);
  if (!fromWay || !toWay) return null;
  const node = sharedEndpoint({
    endpoints,
    fromWay,
    fromForward: from.forward,
    toWay,
    toForward: to.forward,
  });
  if (!node) return null;

  const fromLaneId = serviceLaneOnWay(
    service.path,
    from.index,
    waysById,
    service.modeId,
    from.forward,
    { nextWayId: toWay.id, turnRestrictions },
  );
  const afterTo = legs[index + 2]?.leg.wayId;
  const toLaneId = serviceLaneOnWay(
    service.path,
    to.index,
    waysById,
    service.modeId,
    to.forward,
    afterTo ? { nextWayId: afterTo, turnRestrictions } : undefined,
  );
  if (!fromLaneId || !toLaneId) return null;

  const curve = connectorCurves(node, waysById, trims, turnRestrictions).find(
    (candidate) =>
      candidate.from.wayId === fromWay.id &&
      candidate.from.laneId === fromLaneId &&
      candidate.to.wayId === toWay.id &&
      candidate.to.laneId === toLaneId,
  );
  if (!curve) return null;
  return {
    serviceId: service.id,
    run,
    nodeId: node.id,
    from: curve.from,
    to: curve.to,
    path: curve.path,
  };
}

function leavesAtEndpoint(leg: PatternLeg, forward: boolean): boolean {
  const [from, to] = legRange(leg);
  return forward ? to >= 1 : from <= 0;
}

function entersAtEndpoint(leg: PatternLeg, forward: boolean): boolean {
  const [from, to] = legRange(leg);
  return forward ? from <= 0 : to >= 1;
}

function endpointNodes(nodes: readonly Node[]): ReadonlyMap<string, Node> {
  const result = new Map<string, Node>();
  for (const node of nodes) {
    for (const ref of node.refs) result.set(`${ref.wayId}:${ref.pointIndex}`, node);
  }
  return result;
}

interface SharedEndpointOptions {
  endpoints: ReadonlyMap<string, Node>;
  fromWay: Way;
  fromForward: boolean;
  toWay: Way;
  toForward: boolean;
}

function sharedEndpoint({
  endpoints,
  fromWay,
  fromForward,
  toWay,
  toForward,
}: SharedEndpointOptions): Node | undefined {
  const leaving = fromForward ? fromWay.points.length - 1 : 0;
  const entering = toForward ? 0 : toWay.points.length - 1;
  const fromNode = endpoints.get(`${fromWay.id}:${leaving}`);
  const toNode = endpoints.get(`${toWay.id}:${entering}`);
  return fromNode && fromNode.id === toNode?.id ? fromNode : undefined;
}
