import { haversineMeters, oneSection, patternLegs, patternSegments, wayById } from './geo';
import { pruneLineMembership, withServicePattern } from './line-service';
import { mapSectionLegs, pruneSections, splitLegsIntoRuns } from './patternEdits';
import type { SelectionRef } from './selectionActions';
import { removeGroupMembers } from './system/group';
import type {
  NamedWay,
  Node,
  Pattern,
  PatternLeg,
  Service,
  Station,
  TransitSystem,
  Way,
} from './system';

const JOIN_REUSE_TOLERANCE_M = 0.75;

function legsMeet(ways: Way[], a: PatternLeg, b: PatternLeg): boolean {
  const segments = patternSegments(wayById(ways), {
    id: 'selection-deletion-probe',
    sections: oneSection([a, b]),
  });
  if (segments.length < 2) return false;
  const previousPath = segments[0].path;
  const nextPath = segments[1].path;
  const previousEnd = previousPath[previousPath.length - 1];
  const nextStart = nextPath[0];
  return haversineMeters(previousEnd, nextStart) <= JOIN_REUSE_TOLERANCE_M;
}

function withoutWayFromPattern(pattern: Pattern, wayId: string, ways: Way[]): Pattern | null {
  if (!patternLegs(pattern).some((leg) => leg.wayId === wayId)) return pattern;
  const filtered = mapSectionLegs(pattern.sections, (legs) =>
    legs.filter((leg) => leg.wayId !== wayId),
  );
  const sections = pruneSections(
    mapSectionLegs(filtered, (legs) => {
      const runs = splitLegsIntoRuns(legs, (a, b) => legsMeet(ways, a, b));
      return runs.reduce<PatternLeg[]>(
        (longest, run) => (run.length > longest.length ? run : longest),
        [],
      );
    }),
  );
  return sections.length === 0 ? null : { ...pattern, sections };
}

function withoutWayFromServices(services: Service[], wayId: string, ways: Way[]): Service[] {
  let changed = false;
  const remaining: Service[] = [];
  for (const service of services) {
    const pattern = withoutWayFromPattern(service.path, wayId, ways);
    if (!pattern) {
      changed = true;
      continue;
    }
    if (pattern !== service.path) changed = true;
    remaining.push(pattern === service.path ? service : withServicePattern(service, pattern));
  }
  return changed ? remaining : services;
}

function withoutWayFromStations(stations: Station[], wayId: string): Station[] {
  let changed = false;
  const remaining: Station[] = [];
  for (const station of stations) {
    const anchors = station.anchors.filter((anchor) => anchor.wayId !== wayId);
    if (anchors.length === station.anchors.length) {
      remaining.push(station);
      continue;
    }
    changed = true;
    if (anchors.length > 0) remaining.push({ ...station, anchors });
  }
  return changed ? remaining : stations;
}

function withoutWayFromNodes(nodes: Node[], wayId: string): Node[] {
  let changed = false;
  const remaining: Node[] = [];
  for (const node of nodes) {
    const refs = node.refs.filter((ref) => ref.wayId !== wayId);
    const connectors = node.connectors?.filter(
      (connector) => connector.from.wayId !== wayId && connector.to.wayId !== wayId,
    );
    if (refs.length < 2) {
      changed = true;
      continue;
    }
    if (refs.length === node.refs.length && connectors?.length === node.connectors?.length) {
      remaining.push(node);
      continue;
    }
    changed = true;
    remaining.push({
      ...node,
      refs,
      connectors: connectors && connectors.length > 0 ? connectors : undefined,
    });
  }
  return changed ? remaining : nodes;
}

interface NamedWayRemoval {
  namedWays: NamedWay[];
  removedIds: Set<string>;
}

function withoutWayFromNamedWays(namedWays: NamedWay[], wayId: string): NamedWayRemoval {
  let changed = false;
  const removedIds = new Set<string>();
  const remaining: NamedWay[] = [];
  for (const namedWay of namedWays) {
    if (!namedWay.wayIds.includes(wayId)) {
      remaining.push(namedWay);
      continue;
    }
    changed = true;
    const wayIds = namedWay.wayIds.filter((id) => id !== wayId);
    if (wayIds.length > 0) remaining.push({ ...namedWay, wayIds });
    else removedIds.add(namedWay.id);
  }
  return { namedWays: changed ? remaining : namedWays, removedIds };
}

function withoutKeys<Value>(
  record: Record<string, Value>,
  removed: Set<string>,
): Record<string, Value> {
  if (removed.size === 0) return record;
  const entries = Object.entries(record).filter(([key]) => !removed.has(key));
  return entries.length === Object.keys(record).length ? record : Object.fromEntries(entries);
}

function withoutWayRestrictions(
  restrictions: TransitSystem['turnRestrictions'],
  wayId: string,
): TransitSystem['turnRestrictions'] {
  let changed = false;
  const next: TransitSystem['turnRestrictions'] = {};
  for (const [key, restriction] of Object.entries(restrictions)) {
    if (key.startsWith(`${wayId}:`)) {
      changed = true;
      continue;
    }
    const allowedTargets = restriction.allowedTargets.filter((target) => target !== wayId);
    if (allowedTargets.length !== restriction.allowedTargets.length) changed = true;
    next[key] =
      allowedTargets.length === restriction.allowedTargets.length
        ? restriction
        : { ...restriction, allowedTargets };
  }
  return changed ? next : restrictions;
}

function removeWay(system: TransitSystem, wayId: string): TransitSystem {
  if (!system.ways.some((way) => way.id === wayId)) return system;
  const ways = system.ways.filter((way) => way.id !== wayId);
  const named = withoutWayFromNamedWays(system.namedWays, wayId);
  const services = withoutWayFromServices(system.services, wayId, ways);
  return {
    ...system,
    ways,
    lines: pruneLineMembership(system.lines, services),
    services,
    stations: withoutWayFromStations(system.stations, wayId),
    nodes: withoutWayFromNodes(system.nodes, wayId),
    namedWays: named.namedWays,
    medians: withoutKeys(system.medians, named.removedIds),
    turnRestrictions: withoutWayRestrictions(system.turnRestrictions, wayId),
    approachControls: withoutKeys(
      system.approachControls,
      new Set([`${wayId}:start`, `${wayId}:end`]),
    ),
  };
}

function selectedIds(items: SelectionRef[], kind: SelectionRef['kind']): Set<string> {
  return new Set(items.filter((item) => item.kind === kind).map((item) => item.id));
}

function withoutSelected<RecordType extends { id: string }>(
  records: RecordType[],
  ids: Set<string>,
): RecordType[] {
  if (ids.size === 0 || !records.some((record) => ids.has(record.id))) return records;
  return records.filter((record) => !ids.has(record.id));
}

function removedRecordIds(before: TransitSystem, after: TransitSystem): Set<string> {
  const live = new Set([
    ...after.ways.map((record) => record.id),
    ...after.lines.map((record) => record.id),
    ...after.services.map((record) => record.id),
    ...after.stations.map((record) => record.id),
    ...after.facilities.map((record) => record.id),
  ]);
  return new Set(
    [before.ways, before.lines, before.services, before.stations, before.facilities]
      .flat()
      .map((record) => record.id)
      .filter((id) => !live.has(id)),
  );
}

/** Deletes every selected record and repairs references invalidated by the deletion. */
export function deleteSelection(system: TransitSystem, items: SelectionRef[]): TransitSystem {
  const wayIds = selectedIds(items, 'way');
  const lineIds = selectedIds(items, 'line');
  const serviceIds = selectedIds(items, 'service');
  for (const line of system.lines) {
    if (!lineIds.has(line.id)) continue;
    for (const serviceId of line.serviceIds) serviceIds.add(serviceId);
  }
  const stationIds = selectedIds(items, 'station');
  const facilityIds = selectedIds(items, 'facility');
  const services = withoutSelected(system.services, serviceIds);
  const selectedLines = withoutSelected(system.lines, lineIds);
  const lines = pruneLineMembership(selectedLines, services);
  let next: TransitSystem = {
    ...system,
    lines,
    services,
    stations: withoutSelected(system.stations, stationIds),
    facilities: withoutSelected(system.facilities, facilityIds),
  };
  if (
    next.lines === system.lines &&
    next.services === system.services &&
    next.stations === system.stations &&
    next.facilities === system.facilities
  ) {
    next = system;
  }
  for (const wayId of wayIds) next = removeWay(next, wayId);
  if (next === system) return system;
  const removedIds = removedRecordIds(system, next);
  return removeGroupMembers(next, removedIds);
}
