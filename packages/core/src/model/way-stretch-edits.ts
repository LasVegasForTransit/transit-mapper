import { oneSection, patternLegs, resolveWayPath } from './geo';
import { shortId } from './ids';
import { withServicePattern } from './line-service';
import { removeStretchFromLegs } from './patternEdits';
import { splitContinuousLegRuns } from './pattern-continuity';
import type { Service, TransitSystem } from './system';
import { removeGroupMembers } from './system/group';
import { removeWayFromSystem } from './way-removal';
import { splitWayAtPositionWithResult } from './way-split-results';

const MIN_STRETCH_T = 1e-3;

export type CreateWayStretchId = () => string;

export interface DeleteWayStretchResult {
  system: TransitSystem;
  affectedPatterns: number;
}

export interface DeleteWayStretchOptions {
  wayId: string;
  fromT: number;
  toT: number;
  createId?: CreateWayStretchId;
}

interface StretchRange {
  wayId: string;
  low: number;
  high: number;
  createId: CreateWayStretchId;
}

interface StretchServiceChanges {
  services: Service[];
  replacementIds: Map<string, string[]>;
  affectedPatterns: number;
}

function servicesWithoutStretch(system: TransitSystem, range: StretchRange): StretchServiceChanges {
  let affectedPatterns = 0;
  const replacementIds = new Map<string, string[]>();
  const services: Service[] = [];
  for (const service of system.services) {
    const pattern = service.path;
    const before = patternLegs(pattern);
    const legs = removeStretchFromLegs(before, range.wayId, range.low, range.high);
    if (legs.length === before.length && legs.every((leg, index) => leg === before[index])) {
      replacementIds.set(service.id, [service.id]);
      services.push(service);
      continue;
    }
    affectedPatterns++;
    if (legs.length === 0) {
      replacementIds.set(service.id, []);
      continue;
    }
    const runs = splitContinuousLegRuns(system.ways, legs);
    const divided = runs.map((run, index) => {
      const id = index === 0 ? service.id : range.createId();
      const dividedService =
        index === 0 ? service : { ...service, id, name: `Service ${index + 1}` };
      return withServicePattern(dividedService, {
        ...pattern,
        id,
        sections: oneSection(run),
      });
    });
    replacementIds.set(
      service.id,
      divided.map((candidate) => candidate.id),
    );
    services.push(...divided);
  }
  return {
    services: affectedPatterns === 0 ? system.services : services,
    replacementIds,
    affectedPatterns,
  };
}

function replaceLineServiceIds(
  lines: TransitSystem['lines'],
  replacementIds: Map<string, string[]>,
): TransitSystem['lines'] {
  const next = lines.flatMap((line) => {
    const serviceIds = line.serviceIds.flatMap((id) => replacementIds.get(id) ?? []);
    if (serviceIds.length === 0) return [];
    if (
      serviceIds.length === line.serviceIds.length &&
      serviceIds.every((id, index) => id === line.serviceIds[index])
    ) {
      return [line];
    }
    return [{ ...line, serviceIds }];
  });
  return next.length === lines.length && next.every((line, index) => line === lines[index])
    ? lines
    : next;
}

function removedLineAndServiceIds(
  before: TransitSystem,
  after: TransitSystem,
): ReadonlySet<string> {
  const liveIds = new Set([
    ...after.lines.map((line) => line.id),
    ...after.services.map((service) => service.id),
  ]);
  return new Set(
    [...before.lines, ...before.services]
      .map((record) => record.id)
      .filter((id) => !liveIds.has(id)),
  );
}

/** Removes infrastructure and service coverage over a normalized way range. */
export function deleteWayStretch(
  system: TransitSystem,
  options: DeleteWayStretchOptions,
): DeleteWayStretchResult {
  const { wayId, fromT, toT, createId = shortId } = options;
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way || resolveWayPath(way).length < 2 || !Number.isFinite(fromT) || !Number.isFinite(toT)) {
    return { system, affectedPatterns: 0 };
  }
  const low = Math.max(0, Math.min(1, Math.min(fromT, toT)));
  const high = Math.max(0, Math.min(1, Math.max(fromT, toT)));
  if (high - low < MIN_STRETCH_T) return { system, affectedPatterns: 0 };

  const serviceChange = servicesWithoutStretch(system, { wayId, low, high, createId });
  let next: TransitSystem = {
    ...system,
    services: serviceChange.services,
    lines: replaceLineServiceIds(system.lines, serviceChange.replacementIds),
  };
  const highSplit = splitWayAtPositionWithResult(next, wayId, high, createId);
  next = highSplit?.system ?? next;
  const lowSplit = splitWayAtPositionWithResult(next, wayId, low, createId);
  next = lowSplit?.system ?? next;
  next = removeWayFromSystem(next, lowSplit?.newWayId ?? wayId);
  next = removeGroupMembers(next, removedLineAndServiceIds(system, next));
  return { system: next, affectedPatterns: serviceChange.affectedPatterns };
}
