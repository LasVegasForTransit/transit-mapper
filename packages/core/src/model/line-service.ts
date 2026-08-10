import type { TransitSystem } from './system/document';
import type { Line, Pattern, Service } from './system/service';

const serviceIndexCache = new WeakMap<Service[], Map<string, Service>>();
const lineIndexCache = new WeakMap<Line[], Map<string, Line>>();
const lineByServiceCache = new WeakMap<Line[], Map<string, Line>>();

function servicesById(services: Service[]): Map<string, Service> {
  let index = serviceIndexCache.get(services);
  if (!index) {
    index = new Map(services.map((service) => [service.id, service]));
    serviceIndexCache.set(services, index);
  }
  return index;
}

/** Resolve public Line identities once per immutable Line collection. */
export function linesById(lines: Line[]): Map<string, Line> {
  let index = lineIndexCache.get(lines);
  if (!index) {
    index = new Map(lines.map((line) => [line.id, line]));
    lineIndexCache.set(lines, index);
  }
  return index;
}

/** Resolve Service ownership once per immutable Line collection. */
export function linesByServiceId(lines: Line[]): Map<string, Line> {
  let index = lineByServiceCache.get(lines);
  if (!index) {
    index = new Map<string, Line>();
    for (const line of lines) {
      for (const serviceId of line.serviceIds) {
        if (!index.has(serviceId)) index.set(serviceId, line);
      }
    }
    lineByServiceCache.set(lines, index);
  }
  return index;
}

export type LineServiceMembershipIssue =
  | { kind: 'duplicate-line-id'; lineId: string }
  | { kind: 'duplicate-service-id'; serviceId: string }
  | { kind: 'empty-line'; lineId: string }
  | { kind: 'missing-service'; lineId: string; serviceId: string }
  | { kind: 'duplicate-membership'; serviceId: string; lineIds: string[] }
  | { kind: 'orphaned-service'; serviceId: string };

/** Resolve a Line's Services in the public order stored by that Line. */
export function servicesForLine(system: TransitSystem, lineId: string): Service[] {
  const line = linesById(system.lines).get(lineId);
  if (!line) return [];
  const serviceById = servicesById(system.services);
  return line.serviceIds.flatMap((serviceId) => {
    const service = serviceById.get(serviceId);
    return service ? [service] : [];
  });
}

/** Find the one public Line that owns an operational Service. */
export function lineForService(system: TransitSystem, serviceId: string): Line | undefined {
  return linesByServiceId(system.lines).get(serviceId);
}

/** Adapt a Service's singular path for the established geometry vocabulary. */
export function servicePattern(service: Service): Pattern {
  return service.path;
}

/** A Service label stays technical unless its Line is the only useful label. */
export function serviceDisplayLabel(system: TransitSystem, serviceId: string): string {
  const service = system.services.find((candidate) => candidate.id === serviceId);
  if (!service) return 'Unknown service';
  if (service.name?.trim()) return service.name;
  const line = lineForService(system, serviceId);
  if (!line) return 'Unassigned service';
  if (line.serviceIds.length === 1) return line.name;
  const index = line.serviceIds.indexOf(serviceId);
  return `Service ${index < 0 ? 1 : index + 1}`;
}

/** Modes used by a Line's Services, in their first public appearance order. */
export function lineModes(system: TransitSystem, lineId: string): string[] {
  return [...new Set(servicesForLine(system, lineId).map((service) => service.modeId))];
}

function duplicateIdentityIssues(lines: Line[], services: Service[]): LineServiceMembershipIssue[] {
  const issues: LineServiceMembershipIssue[] = [];
  const seenLineIds = new Set<string>();
  const seenServiceIds = new Set<string>();
  for (const line of lines) {
    if (seenLineIds.has(line.id)) issues.push({ kind: 'duplicate-line-id', lineId: line.id });
    seenLineIds.add(line.id);
  }
  for (const service of services) {
    if (seenServiceIds.has(service.id)) {
      issues.push({ kind: 'duplicate-service-id', serviceId: service.id });
    }
    seenServiceIds.add(service.id);
  }
  return issues;
}

function lineMembershipIssues(
  lines: Line[],
  liveServiceIds: Set<string>,
  lineIdsByService: Map<string, string[]>,
): LineServiceMembershipIssue[] {
  const issues: LineServiceMembershipIssue[] = [];
  for (const line of lines) {
    if (line.serviceIds.length === 0) issues.push({ kind: 'empty-line', lineId: line.id });
    for (const serviceId of line.serviceIds) {
      if (!liveServiceIds.has(serviceId)) {
        issues.push({ kind: 'missing-service', lineId: line.id, serviceId });
      }
      const lineIds = lineIdsByService.get(serviceId) ?? [];
      lineIds.push(line.id);
      lineIdsByService.set(serviceId, lineIds);
    }
  }
  return issues;
}

function serviceOwnershipIssues(
  services: Service[],
  lineIdsByService: Map<string, string[]>,
): LineServiceMembershipIssue[] {
  const issues: LineServiceMembershipIssue[] = [];
  const liveServiceIds = new Set(services.map((service) => service.id));
  for (const [serviceId, lineIds] of lineIdsByService) {
    if (liveServiceIds.has(serviceId) && lineIds.length > 1) {
      issues.push({ kind: 'duplicate-membership', serviceId, lineIds });
    }
  }
  for (const service of services) {
    if (!lineIdsByService.has(service.id)) {
      issues.push({ kind: 'orphaned-service', serviceId: service.id });
    }
  }
  return issues;
}

/** Report every contradiction in the single stored Line -> Service relation. */
export function validateLineServiceMembership(system: TransitSystem): LineServiceMembershipIssue[] {
  const liveServiceIds = new Set(system.services.map((service) => service.id));
  const lineIdsByService = new Map<string, string[]>();
  return [
    ...duplicateIdentityIssues(system.lines, system.services),
    ...lineMembershipIssues(system.lines, liveServiceIds, lineIdsByService),
    ...serviceOwnershipIssues(system.services, lineIdsByService),
  ];
}
