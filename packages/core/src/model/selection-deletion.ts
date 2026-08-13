import { patternLegs } from './geo';
import { pruneLineMembership, withServicePattern } from './line-service';
import { mapSectionLegs } from './patternEdits';
import { longestContinuousPatternSections } from './pattern-continuity';
import type { SelectionRef } from './selectionActions';
import { removeGroupMembers } from './system/group';
import type { NamedWay, Node, Pattern, Service, Stop, TransitSystem, Way } from './system';

function withoutWaysFromPattern(
  pattern: Pattern,
  wayIds: ReadonlySet<string>,
  ways: Way[],
): Pattern | null {
  if (!patternLegs(pattern).some((leg) => wayIds.has(leg.wayId))) return pattern;
  const filtered = mapSectionLegs(pattern.sections, (legs) => {
    if (!legs.some((leg) => wayIds.has(leg.wayId))) return legs;
    return legs.filter((leg) => !wayIds.has(leg.wayId));
  });
  const sections = longestContinuousPatternSections(ways, filtered);
  return sections.length === 0 ? null : { ...pattern, sections };
}

function withoutWaysFromServices(
  services: Service[],
  wayIds: ReadonlySet<string>,
  ways: Way[],
): Service[] {
  let changed = false;
  const remaining: Service[] = [];
  for (const service of services) {
    const pattern = withoutWaysFromPattern(service.path, wayIds, ways);
    if (!pattern) {
      changed = true;
      continue;
    }
    if (pattern !== service.path) changed = true;
    remaining.push(pattern === service.path ? service : withServicePattern(service, pattern));
  }
  return changed ? remaining : services;
}

function withoutWaysFromStops(stops: Stop[], wayIds: ReadonlySet<string>): Stop[] {
  let changed = false;
  const remaining: Stop[] = [];
  for (const stop of stops) {
    const anchors = stop.anchors.filter((anchor) => !wayIds.has(anchor.wayId));
    if (anchors.length === stop.anchors.length) {
      remaining.push(stop);
      continue;
    }
    changed = true;
    if (anchors.length > 0) remaining.push({ ...stop, anchors });
  }
  return changed ? remaining : stops;
}

function withoutWaysFromNodes(nodes: Node[], wayIds: ReadonlySet<string>): Node[] {
  let changed = false;
  const remaining: Node[] = [];
  for (const node of nodes) {
    const refs = node.refs.filter((ref) => !wayIds.has(ref.wayId));
    const connectors = node.connectors?.filter(
      (connector) => !wayIds.has(connector.from.wayId) && !wayIds.has(connector.to.wayId),
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

function withoutWaysFromNamedWays(
  namedWays: NamedWay[],
  removedWayIds: ReadonlySet<string>,
): NamedWayRemoval {
  let changed = false;
  const removedIds = new Set<string>();
  const remaining: NamedWay[] = [];
  for (const namedWay of namedWays) {
    if (!namedWay.wayIds.some((wayId) => removedWayIds.has(wayId))) {
      remaining.push(namedWay);
      continue;
    }
    changed = true;
    const wayIds = namedWay.wayIds.filter((id) => !removedWayIds.has(id));
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
  wayIds: ReadonlySet<string>,
): TransitSystem['turnRestrictions'] {
  let changed = false;
  const next: TransitSystem['turnRestrictions'] = {};
  for (const [key, restriction] of Object.entries(restrictions)) {
    const separator = key.indexOf(':');
    if (separator >= 0 && wayIds.has(key.slice(0, separator))) {
      changed = true;
      continue;
    }
    const allowedTargets = restriction.allowedTargets.filter((target) => !wayIds.has(target));
    if (allowedTargets.length !== restriction.allowedTargets.length) changed = true;
    next[key] =
      allowedTargets.length === restriction.allowedTargets.length
        ? restriction
        : { ...restriction, allowedTargets };
  }
  return changed ? next : restrictions;
}

function removeWays(system: TransitSystem, selectedWayIds: ReadonlySet<string>): TransitSystem {
  const wayIds = new Set(
    system.ways.filter((way) => selectedWayIds.has(way.id)).map((way) => way.id),
  );
  if (wayIds.size === 0) return system;
  const ways = system.ways.filter((way) => !wayIds.has(way.id));
  const named = withoutWaysFromNamedWays(system.namedWays, wayIds);
  const services = withoutWaysFromServices(system.services, wayIds, ways);
  const approachKeys = new Set([...wayIds].flatMap((wayId) => [`${wayId}:start`, `${wayId}:end`]));
  return {
    ...system,
    ways,
    lines: pruneLineMembership(system.lines, services),
    services,
    stops: withoutWaysFromStops(system.stops, wayIds),
    nodes: withoutWaysFromNodes(system.nodes, wayIds),
    namedWays: named.namedWays,
    medians: withoutKeys(system.medians, named.removedIds),
    turnRestrictions: withoutWayRestrictions(system.turnRestrictions, wayIds),
    approachControls: withoutKeys(system.approachControls, approachKeys),
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

function withoutSkippedStops(pattern: Pattern, stopIds: ReadonlySet<string>): Pattern {
  const skipped = pattern.skippedStops;
  if (!skipped) return pattern;
  const outbound = (skipped.outbound ?? []).filter((id) => !stopIds.has(id));
  const inbound = (skipped.inbound ?? []).filter((id) => !stopIds.has(id));
  const unchanged =
    outbound.length === (skipped.outbound?.length ?? 0) &&
    inbound.length === (skipped.inbound?.length ?? 0);
  if (unchanged) return pattern;
  const { skippedStops: _removed, ...bare } = pattern;
  if (outbound.length + inbound.length === 0) return bare;
  return {
    ...bare,
    skippedStops: {
      ...(outbound.length > 0 ? { outbound } : {}),
      ...(inbound.length > 0 ? { inbound } : {}),
    },
  };
}

function removeSkippedStops(services: Service[], stopIds: ReadonlySet<string>): Service[] {
  if (stopIds.size === 0) return services;
  const next = services.map((service) => {
    const pattern = withoutSkippedStops(service.path, stopIds);
    if (pattern === service.path) return service;
    return withServicePattern(service, pattern);
  });
  return next.every((service, index) => service === services[index]) ? services : next;
}

function removedRecordIds(before: TransitSystem, after: TransitSystem): Set<string> {
  const live = new Set([
    ...after.ways.map((record) => record.id),
    ...after.lines.map((record) => record.id),
    ...after.services.map((record) => record.id),
    ...after.stops.map((record) => record.id),
    ...after.stations.map((record) => record.id),
    ...after.facilities.map((record) => record.id),
    ...after.namedWays.map((record) => record.id),
  ]);
  return new Set(
    [
      before.ways,
      before.lines,
      before.services,
      before.stops,
      before.stations,
      before.facilities,
      before.namedWays,
    ]
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
  const stopIds = selectedIds(items, 'stop');
  const stationIds = selectedIds(items, 'station');
  const facilityIds = selectedIds(items, 'facility');
  const services = withoutSelected(system.services, serviceIds);
  const selectedLines = withoutSelected(system.lines, lineIds);
  const lines = pruneLineMembership(selectedLines, services);
  const selectedStops = withoutSelected(system.stops, stopIds);
  const stops =
    stationIds.size === 0
      ? selectedStops
      : selectedStops.map((stop) =>
          stop.stationId && stationIds.has(stop.stationId)
            ? { ...stop, stationId: undefined }
            : stop,
        );
  let next: TransitSystem = {
    ...system,
    lines,
    services,
    stops,
    stations: withoutSelected(system.stations, stationIds),
    facilities: withoutSelected(system.facilities, facilityIds),
  };
  if (
    next.lines === system.lines &&
    next.services === system.services &&
    next.stops === system.stops &&
    next.stations === system.stations &&
    next.facilities === system.facilities
  ) {
    next = system;
  }
  next = removeWays(next, wayIds);
  if (next === system) return system;
  const liveStopIds = new Set(next.stops.map((stop) => stop.id));
  const removedStopIds = new Set(
    system.stops.filter((stop) => !liveStopIds.has(stop.id)).map((stop) => stop.id),
  );
  const cleanedServices = removeSkippedStops(next.services, removedStopIds);
  if (cleanedServices !== next.services) next = { ...next, services: cleanedServices };
  const removedIds = removedRecordIds(system, next);
  return removeGroupMembers(next, removedIds);
}
