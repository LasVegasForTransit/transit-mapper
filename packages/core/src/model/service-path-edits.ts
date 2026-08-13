import { pathLengthMeters, patternRunPath } from './geo';
import { lineForService, withServicePattern } from './line-service';
import type {
  Pattern,
  PatternLeg,
  PatternSection,
  RunDirection,
  Service,
  TransitSystem,
} from './system';

function patternLegEqual(left: PatternLeg, right: PatternLeg): boolean {
  if (
    left.wayId !== right.wayId ||
    left.direction !== right.direction ||
    left.extent.kind !== right.extent.kind ||
    left.lane.kind !== right.lane.kind
  )
    return false;
  if (
    left.extent.kind === 'stretch' &&
    (right.extent.kind !== 'stretch' ||
      left.extent.fromT !== right.extent.fromT ||
      left.extent.toT !== right.extent.toT)
  )
    return false;
  return !(
    left.lane.kind === 'pinned' &&
    (right.lane.kind !== 'pinned' || left.lane.laneId !== right.lane.laneId)
  );
}

function patternLegsEqual(left: PatternLeg[], right: PatternLeg[]): boolean {
  return (
    left.length === right.length && left.every((leg, index) => patternLegEqual(leg, right[index]))
  );
}

export function patternSectionsEqual(left: PatternSection[], right: PatternSection[]): boolean {
  return (
    left.length === right.length &&
    left.every((section, index) => {
      const other = right[index];
      if (section.kind !== other.kind) return false;
      if (section.kind === 'split') {
        return (
          other.kind === 'split' &&
          patternLegsEqual(section.outbound, other.outbound) &&
          patternLegsEqual(section.inbound, other.inbound)
        );
      }
      return other.kind !== 'split' && patternLegsEqual(section.legs, other.legs);
    })
  );
}

function stringArraysEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  if (left === right) return true;
  return (
    left?.length === right?.length &&
    left !== undefined &&
    right !== undefined &&
    left.every((value, index) => value === right[index])
  );
}

function patternsEqual(left: Pattern, right: Pattern): boolean {
  return (
    patternSectionsEqual(left.sections, right.sections) &&
    stringArraysEqual(left.skippedStops?.outbound, right.skippedStops?.outbound) &&
    stringArraysEqual(left.skippedStops?.inbound, right.skippedStops?.inbound)
  );
}

/** Replace sections only when they describe a materially different path. */
export function withPatternSections(pattern: Pattern, sections: PatternSection[]): Pattern {
  return patternSectionsEqual(pattern.sections, sections) ? pattern : { ...pattern, sections };
}

/** Replace one Service path without applying document timestamp policy. */
export function replaceServicePath(
  system: TransitSystem,
  serviceId: string,
  patternId: string,
  nextPattern: Pattern,
): TransitSystem {
  const service = system.services.find((candidate) => candidate.id === serviceId);
  const pattern = service?.path.id === patternId ? service.path : undefined;
  if (!service || !pattern || patternsEqual(pattern, nextPattern)) return system;
  const nextService = withServicePattern(service, nextPattern);
  return {
    ...system,
    services: system.services.map((candidate) => (candidate === service ? nextService : candidate)),
  };
}

/** Measure a path's complete operating cycle across both directions. */
export function servicePathOperatingMeters(system: TransitSystem, pattern: Pattern): number {
  return (
    pathLengthMeters(patternRunPath(system.ways, pattern, 'outbound')) +
    pathLengthMeters(patternRunPath(system.ways, pattern, 'inbound'))
  );
}

/** Set one derived stop exception while omitting an empty exception record. */
export function setPatternStopSkipped(
  pattern: Pattern,
  run: RunDirection,
  stopId: string,
  skipped: boolean,
): Pattern {
  const current = pattern.skippedStops?.[run] ?? [];
  if (current.includes(stopId) === skipped) return pattern;
  const next = new Set(current);
  if (skipped) next.add(stopId);
  else next.delete(stopId);
  const outbound = run === 'outbound' ? [...next] : (pattern.skippedStops?.outbound ?? []);
  const inbound = run === 'inbound' ? [...next] : (pattern.skippedStops?.inbound ?? []);
  const { skippedStops: _removed, ...bare } = pattern;
  if (outbound.length === 0 && inbound.length === 0) return bare;
  return {
    ...bare,
    skippedStops: {
      ...(outbound.length > 0 ? { outbound } : {}),
      ...(inbound.length > 0 ? { inbound } : {}),
    },
  };
}

interface SourceLineDivision {
  kind: 'source';
}

interface NewLineDivision {
  kind: 'new';
  id: string;
  name: string;
  color: string;
}

export interface ServicePathDivision {
  sourceServiceId: string;
  spawnedServiceId: string;
  remaining: Pattern;
  divided: Pattern;
  line: SourceLineDivision | NewLineDivision;
}

function spawnedService(source: Service, division: ServicePathDivision): Service {
  const name = source.name
    ? `${source.name} 2`
    : division.line.kind === 'source'
      ? 'Service 2'
      : undefined;
  return {
    ...source,
    id: division.spawnedServiceId,
    name,
    path: {
      id: division.spawnedServiceId,
      sections: division.divided.sections,
      ...(division.divided.skippedStops ? { skippedStops: division.divided.skippedStops } : {}),
    },
  };
}

/** Divide one Service while keeping Line membership internally consistent. */
export function divideServicePath(
  system: TransitSystem,
  division: ServicePathDivision,
): TransitSystem {
  const source = system.services.find((candidate) => candidate.id === division.sourceServiceId);
  const sourceLine = source ? lineForService(system, source.id) : undefined;
  const duplicateService = system.services.some(
    (candidate) => candidate.id === division.spawnedServiceId,
  );
  const divisionLine = division.line;
  const duplicateLine =
    divisionLine.kind === 'new' &&
    system.lines.some((candidate) => candidate.id === divisionLine.id);
  if (!source || !sourceLine || duplicateService || duplicateLine) return system;

  const spawned = spawnedService(source, division);
  const remainingSource = withServicePattern(source, division.remaining);
  const lines =
    division.line.kind === 'source'
      ? system.lines.map((line) =>
          line === sourceLine ? { ...line, serviceIds: [...line.serviceIds, spawned.id] } : line,
        )
      : [
          ...system.lines,
          {
            id: division.line.id,
            name: division.line.name,
            color: division.line.color,
            serviceIds: [spawned.id],
          },
        ];
  return {
    ...system,
    lines,
    services: [
      ...system.services.map((candidate) => (candidate === source ? remainingSource : candidate)),
      spawned,
    ],
  };
}
