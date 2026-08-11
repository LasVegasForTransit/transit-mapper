import {
  haversineMeters,
  oneSection,
  patternLegs,
  patternSegments,
  resolveWayPath,
  wayById,
} from './geo';
import { shortId } from './ids';
import { withServicePattern } from './line-service';
import { removeStretchFromLegs, splitLegsIntoRuns } from './patternEdits';
import type { PatternLeg, Service, TransitSystem, Way } from './system';
import { removeWayFromSystem } from './way-removal';
import { splitWayAtPositionWithResult } from './way-split-results';

const MIN_STRETCH_T = 1e-3;
const JOIN_TOLERANCE_M = 0.75;

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

function legsMeet(ways: Way[], left: PatternLeg, right: PatternLeg): boolean {
  const segments = patternSegments(wayById(ways), {
    id: 'stretch-delete-probe',
    sections: oneSection([left, right]),
  });
  if (segments.length < 2) return false;
  const leftEnd = segments[0].path[segments[0].path.length - 1];
  const rightStart = segments[1].path[0];
  return haversineMeters(leftEnd, rightStart) <= JOIN_TOLERANCE_M;
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
    const runs = splitLegsIntoRuns(legs, (left, right) => legsMeet(system.ways, left, right));
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
  return { system: next, affectedPatterns: serviceChange.affectedPatterns };
}
