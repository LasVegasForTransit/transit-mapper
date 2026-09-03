import type { GeographicBounds, LngLat } from '../../geography/bounds';
import { resolveWayPath } from '../../model/geo/wayPath';
import type { Facility, Group, Node, TransitSystem } from '../../model/system';
import type { TransitEntityRef } from '../../model/transit-entity-ref';
import type {
  ResolvedAreaFragment,
  ResolvedFacility,
  ResolvedInfrastructureChunk,
  ResolvedNamedWay,
} from '../resolved-network-chunk';
import {
  clipAreaFragments,
  mappedPolygon,
  pathIntersectsBounds,
  pointInBounds,
  polygonIntersectsBounds,
  validCoordinate,
} from './bounds';
import { legacyDerivedId } from './identity';
import { mapInfrastructureControls } from './infrastructure-controls';

export interface InfrastructureMappingContext {
  system: TransitSystem;
  bounds: GeographicBounds;
  includedWayIds: ReadonlySet<string>;
  includedStopIds: ReadonlySet<string>;
  includedStationIds: ReadonlySet<string>;
  includedLineIds: ReadonlySet<string>;
  includedServiceIds: ReadonlySet<string>;
}

export function boundedPhysicalWayIds(
  system: TransitSystem,
  bounds: GeographicBounds,
): Set<string> {
  const ids = new Set<string>();
  for (const way of system.ways) {
    if (way.points.length < 2 || !way.points.every(validCoordinate)) continue;
    if (pathIntersectsBounds(resolveWayPath(way), bounds)) ids.add(way.id);
  }
  return ids;
}

type NodeFacts = Pick<ResolvedInfrastructureChunk, 'nodes' | 'laneConnectors'>;
type NamedWayFacts = Pick<ResolvedInfrastructureChunk, 'namedWays' | 'medians'>;
type FacilityFacts = Pick<ResolvedInfrastructureChunk, 'facilities' | 'areas'>;
type GroupFacts = Pick<ResolvedInfrastructureChunk, 'groups' | 'groupMembers' | 'areas'>;

function selectedNodes(context: InfrastructureMappingContext): Node[] {
  return context.system.nodes.filter((node) => pointInBounds(node.coord, context.bounds));
}

function mapLaneConnectors(
  nodes: readonly Node[],
  includedWayIds: ReadonlySet<string>,
): NodeFacts['laneConnectors'] {
  return nodes.flatMap((node) =>
    (node.connectors ?? []).flatMap((connector, index) => {
      if (!includedWayIds.has(connector.from.wayId) || !includedWayIds.has(connector.to.wayId)) {
        return [];
      }
      return [
        {
          id: legacyDerivedId(
            'lane-connector',
            node.id,
            index,
            connector.from.wayId,
            connector.from.laneId,
            connector.to.wayId,
            connector.to.laneId,
          ),
          nodeId: node.id,
          from: connector.from,
          to: connector.to,
        },
      ];
    }),
  );
}

function mapNodeFacts(context: InfrastructureMappingContext, source: readonly Node[]): NodeFacts {
  const nodes = source.map((node) => ({
    id: node.id,
    location: validCoordinate(node.coord)
      ? ({ kind: 'known', value: node.coord } as const)
      : ({ kind: 'unknown' } as const),
    wayPoints: node.refs.filter((reference) => context.includedWayIds.has(reference.wayId)),
    ...(node.control === undefined ? {} : { controlId: node.control }),
  }));
  return { nodes, laneConnectors: mapLaneConnectors(source, context.includedWayIds) };
}

function mapNamedWayFacts(context: InfrastructureMappingContext): NamedWayFacts {
  const namedWays: ResolvedNamedWay[] = [];
  for (const namedWay of context.system.namedWays) {
    let wayIds: [string, ...string[]] | undefined;
    for (const wayId of namedWay.wayIds) {
      if (!context.includedWayIds.has(wayId)) continue;
      if (wayIds) wayIds.push(wayId);
      else wayIds = [wayId];
    }
    if (wayIds) namedWays.push({ id: namedWay.id, name: namedWay.name, wayIds });
  }
  const includedIds = new Set(namedWays.map(({ id }) => id));
  const medians = Object.entries(context.system.medians).flatMap(([namedWayId, median]) =>
    includedIds.has(namedWayId)
      ? [
          {
            id: legacyDerivedId('median', namedWayId),
            namedWayId,
            widthMeters: median.widthM,
            kindId: median.kindId,
          },
        ]
      : [],
  );
  return { namedWays, medians };
}

function isAreaFacility(facility: Facility): facility is Facility & { geometry: LngLat[] } {
  return Array.isArray(facility.geometry[0]);
}

function resolvedFacility(facility: Facility): ResolvedFacility {
  return {
    id: facility.id,
    typeId: facility.typeId,
    ...(facility.name ? { name: facility.name } : {}),
  };
}

function mappedAreaFacility(
  context: InfrastructureMappingContext,
  facility: Facility & { geometry: LngLat[] },
): FacilityFacts | undefined {
  const polygon = mappedPolygon(facility.geometry);
  if (!polygon) return undefined;
  const areas = clipAreaFragments({ kind: 'facility', id: facility.id }, polygon, context.bounds);
  return areas.length === 0 ? undefined : { facilities: [resolvedFacility(facility)], areas };
}

function mappedPointFacility(
  context: InfrastructureMappingContext,
  facility: Facility,
): ResolvedFacility | undefined {
  const location = facility.geometry as LngLat;
  return validCoordinate(location) && pointInBounds(location, context.bounds)
    ? { ...resolvedFacility(facility), location }
    : undefined;
}

function mapFacilityFacts(context: InfrastructureMappingContext): FacilityFacts {
  const facilities: ResolvedFacility[] = [];
  const areas: ResolvedAreaFragment[] = [];
  for (const facility of context.system.facilities) {
    if (isAreaFacility(facility)) {
      const facts = mappedAreaFacility(context, facility);
      if (facts) {
        facilities.push(...facts.facilities);
        areas.push(...facts.areas);
      }
      continue;
    }
    const mapped = mappedPointFacility(context, facility);
    if (mapped) facilities.push(mapped);
  }
  return { facilities, areas };
}

function candidateMemberReferences(system: TransitSystem, id: string): TransitEntityRef[] {
  const candidates: TransitEntityRef[] = [];
  if (system.lines.some((line) => line.id === id)) candidates.push({ kind: 'line', id });
  if (system.services.some((service) => service.id === id))
    candidates.push({ kind: 'service-plan', id });
  if (system.stops.some((stop) => stop.id === id)) candidates.push({ kind: 'stop', id });
  if (system.stations.some((station) => station.id === id))
    candidates.push({ kind: 'station', id });
  if (system.facilities.some((facility) => facility.id === id))
    candidates.push({ kind: 'facility', id });
  if (system.groups.some((group) => group.id === id)) candidates.push({ kind: 'group', id });
  if (system.ways.some((way) => way.id === id)) candidates.push({ kind: 'way', id });
  if (system.nodes.some((node) => node.id === id)) candidates.push({ kind: 'node', id });
  if (system.namedWays.some((namedWay) => namedWay.id === id))
    candidates.push({ kind: 'named-way', id });
  return candidates;
}

function mapMemberReference(
  system: TransitSystem,
  id: string,
  includedIds: ReadonlySet<string>,
): TransitEntityRef | undefined {
  const candidates = candidateMemberReferences(system, id);
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0];
  return includedIds.has(`${candidate.kind}:${candidate.id}`) ? candidate : undefined;
}

function includedEntityKeys(
  context: InfrastructureMappingContext,
  nodeFacts: NodeFacts,
  namedWayFacts: NamedWayFacts,
  facilityFacts: FacilityFacts,
): Set<string> {
  const keys = (kind: string, ids: Iterable<string>) => Array.from(ids, (id) => `${kind}:${id}`);
  return new Set([
    ...keys('way', context.includedWayIds),
    ...keys('stop', context.includedStopIds),
    ...keys('station', context.includedStationIds),
    ...keys('line', context.includedLineIds),
    ...keys('service-plan', context.includedServiceIds),
    ...keys(
      'facility',
      facilityFacts.facilities.map(({ id }) => id),
    ),
    ...keys(
      'node',
      nodeFacts.nodes.map(({ id }) => id),
    ),
    ...keys(
      'named-way',
      namedWayFacts.namedWays.map(({ id }) => id),
    ),
  ]);
}

function selectedGroups(
  context: InfrastructureMappingContext,
  includedIds: ReadonlySet<string>,
): Group[] {
  return context.system.groups.filter((group) => {
    const polygon = group.footprint ? mappedPolygon(group.footprint) : undefined;
    if (polygon && polygonIntersectsBounds(polygon, context.bounds)) return true;
    return group.memberIds.some(
      (id) => mapMemberReference(context.system, id, includedIds) !== undefined,
    );
  });
}

function mapGroupFacts(
  context: InfrastructureMappingContext,
  includedIds: Set<string>,
): GroupFacts {
  const selected = selectedGroups(context, includedIds);
  const groups = selected.map((group) => ({
    id: group.id,
    ...(group.name ? { name: group.name } : {}),
    ...(group.color ? { color: group.color } : {}),
  }));
  for (const group of selected) includedIds.add(`group:${group.id}`);
  const groupMembers = selected.flatMap((group) =>
    group.memberIds.flatMap((id, index) => {
      const member = mapMemberReference(context.system, id, includedIds);
      return member
        ? [
            {
              id: legacyDerivedId('group-member', group.id, index, member.kind, member.id),
              groupId: group.id,
              member,
            },
          ]
        : [];
    }),
  );
  const areas = selected.flatMap((group) => {
    const polygon = group.footprint ? mappedPolygon(group.footprint) : undefined;
    return polygon
      ? clipAreaFragments({ kind: 'group', id: group.id }, polygon, context.bounds)
      : [];
  });
  return { groups, groupMembers, areas };
}

function stationAreas(context: InfrastructureMappingContext): ResolvedAreaFragment[] {
  return context.system.stations.flatMap((station) => {
    if (!context.includedStationIds.has(station.id) || !station.footprint) return [];
    const polygon = mappedPolygon(station.footprint);
    return polygon
      ? clipAreaFragments({ kind: 'station', id: station.id }, polygon, context.bounds)
      : [];
  });
}

export function mapInfrastructure(
  context: InfrastructureMappingContext,
): ResolvedInfrastructureChunk {
  const sourceNodes = selectedNodes(context);
  const nodeFacts = mapNodeFacts(context, sourceNodes);
  const controls = mapInfrastructureControls(context.system, sourceNodes, context.includedWayIds);
  const namedWayFacts = mapNamedWayFacts(context);
  const facilityFacts = mapFacilityFacts(context);
  const includedIds = includedEntityKeys(context, nodeFacts, namedWayFacts, facilityFacts);
  const groupFacts = mapGroupFacts(context, includedIds);
  return {
    nodes: nodeFacts.nodes,
    namedWays: namedWayFacts.namedWays,
    medians: namedWayFacts.medians,
    laneConnectors: nodeFacts.laneConnectors,
    turnRestrictions: controls.turnRestrictions,
    approachControls: controls.approachControls,
    facilities: facilityFacts.facilities,
    groups: groupFacts.groups,
    groupMembers: groupFacts.groupMembers,
    areas: [...facilityFacts.areas, ...groupFacts.areas, ...stationAreas(context)],
  };
}
