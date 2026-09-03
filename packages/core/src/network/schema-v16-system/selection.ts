import { legRange, patternRunLegs } from '../../model/geo/servicePaths';
import { slicePathByT } from '../../model/geo/measurement';
import { resolveWayPath } from '../../model/geo/wayPath';
import type { Line, Service, TransitSystem } from '../../model/system';
import type { NetworkQuery } from '../query';
import { visibleFragmentPieces, type TransferredLegFragment } from './carrier-transfer';
import { pathIntersectsBounds, validCoordinate } from './bounds';
import { boundedPhysicalWayIds } from './infrastructure';
import { derivePattern, wayToServiceIndex, wayToStopIndex, type DerivedPattern } from './patterns';

export interface NetworkSelection {
  services: Service[];
  serviceIds: Set<string>;
  lines: Line[];
  patterns: DerivedPattern[];
  physicalWayIds: Set<string>;
  visibleFragments: TransferredLegFragment[];
  visibleSemanticFragmentIds: Set<string>;
  semanticCarrierClosureFragmentIds: Set<string>;
}

interface VisibleLineSelection {
  lines: Line[];
  linesByServiceId: Map<string, Line[]>;
  seedWayIdsByLineId: Map<string, Set<string>>;
}

interface SemanticCarrierClosure {
  fragmentIds: Set<string>;
  patternIds: Set<string>;
}

export function selectedServices(system: TransitSystem, query: NetworkQuery): Service[] {
  if (query.modes.kind === 'all') return system.services;
  const selectedModeIds = new Set(query.modes.ids);
  return system.services.filter((service) => selectedModeIds.has(service.modeId));
}

export function queryFilterEffect(
  system: TransitSystem,
  selected: readonly Service[],
  query: NetworkQuery,
) {
  if (query.modes.kind === 'all') return 'not-applied' as const;
  if (selected.length === 0) return 'excluded' as const;
  if (selected.length === system.services.length) return 'included' as const;
  return 'partial' as const;
}

function serviceIntersectsBounds(
  service: Service,
  waysById: ReadonlyMap<string, TransitSystem['ways'][number]>,
  query: NetworkQuery,
): boolean {
  for (const run of ['outbound', 'inbound'] as const) {
    for (const { leg } of patternRunLegs(service.path, run)) {
      const way = waysById.get(leg.wayId);
      if (!way || way.points.length < 2 || !way.points.every(validCoordinate)) continue;
      const range = legRange(leg);
      if (
        !Number.isFinite(range[0]) ||
        !Number.isFinite(range[1]) ||
        range[0] < 0 ||
        range[1] > 1 ||
        range[0] === range[1]
      ) {
        continue;
      }
      const path = slicePathByT(resolveWayPath(way), range[0], range[1]);
      if (pathIntersectsBounds(path, query.bounds)) return true;
    }
  }
  return false;
}

export function queryServiceEvidence(
  system: TransitSystem,
  query: NetworkQuery,
  selectedGeometryPresent: boolean,
) {
  if (selectedGeometryPresent) return 'present' as const;
  if (query.modes.kind === 'all') return 'unknown' as const;
  const waysById = new Map(system.ways.map((way) => [way.id, way]));
  return system.services.some((service) => serviceIntersectsBounds(service, waysById, query))
    ? ('present' as const)
    : ('unknown' as const);
}

export function candidateServiceIds(
  servicesByWayId: ReadonlyMap<string, readonly Service[]>,
  wayIds: ReadonlySet<string>,
): Set<string> {
  const result = new Set<string>();
  for (const wayId of wayIds) {
    for (const service of servicesByWayId.get(wayId) ?? []) result.add(service.id);
  }
  return result;
}

function derivedPatterns(system: TransitSystem, services: readonly Service[]): DerivedPattern[] {
  const waysById = new Map(system.ways.map((way) => [way.id, way]));
  const stopsByWayId = wayToStopIndex(system.stops);
  return services.flatMap((service) =>
    (['outbound', 'inbound'] as const).flatMap((run) => {
      const pattern = derivePattern(service, run, waysById, stopsByWayId);
      return pattern ? [pattern] : [];
    }),
  );
}

function selectedVisibleLines(
  system: TransitSystem,
  patterns: readonly DerivedPattern[],
  visibleFragments: readonly TransferredLegFragment[],
): VisibleLineSelection {
  const visiblePatternIds = new Set(visibleFragments.map(({ source }) => source.patternId));
  const visibleServiceIds = new Set(
    patterns
      .filter((pattern) => visiblePatternIds.has(pattern.patternId))
      .map(({ service }) => service.id),
  );
  const lines = system.lines.filter((line) =>
    line.serviceIds.some((id) => visibleServiceIds.has(id)),
  );
  const linesByServiceId = new Map<string, Line[]>();
  const seedWayIdsByLineId = new Map(lines.map(({ id }) => [id, new Set<string>()]));
  for (const line of lines) {
    for (const serviceId of line.serviceIds) {
      const serviceLines = linesByServiceId.get(serviceId) ?? [];
      serviceLines.push(line);
      linesByServiceId.set(serviceId, serviceLines);
    }
  }
  const patternsById = new Map(patterns.map((pattern) => [pattern.patternId, pattern]));
  for (const { source } of visibleFragments) {
    const pattern = patternsById.get(source.patternId);
    if (!pattern) continue;
    for (const line of linesByServiceId.get(pattern.service.id) ?? []) {
      seedWayIdsByLineId.get(line.id)?.add(source.way.id);
    }
  }
  return { lines, linesByServiceId, seedWayIdsByLineId };
}

function semanticCarrierClosure(
  patterns: readonly DerivedPattern[],
  visibleLines: VisibleLineSelection,
): SemanticCarrierClosure {
  const fragmentIds = new Set<string>();
  const patternIds = new Set<string>();
  for (const pattern of patterns) {
    for (const line of visibleLines.linesByServiceId.get(pattern.service.id) ?? []) {
      const seedWayIds = visibleLines.seedWayIdsByLineId.get(line.id);
      if (!seedWayIds) continue;
      for (const fragment of pattern.fragments) {
        if (!seedWayIds.has(fragment.way.id)) continue;
        fragmentIds.add(fragment.id);
        patternIds.add(pattern.patternId);
      }
    }
  }
  return { fragmentIds, patternIds };
}

export function selectNetwork(system: TransitSystem, query: NetworkQuery): NetworkSelection {
  const physicalWayIds = boundedPhysicalWayIds(system, query.bounds);
  const modeEligibleServices = selectedServices(system, query);
  const preselectedIds = candidateServiceIds(
    wayToServiceIndex(modeEligibleServices),
    physicalWayIds,
  );
  const preselectedServices = modeEligibleServices.filter(({ id }) => preselectedIds.has(id));
  const expandedPatterns = derivedPatterns(system, preselectedServices);
  const visibleFragments = expandedPatterns.flatMap((pattern) =>
    pattern.fragments.flatMap((fragment) => visibleFragmentPieces(fragment, query)),
  );
  const visiblePatternIds = new Set(visibleFragments.map(({ source }) => source.patternId));
  const visibleLines = selectedVisibleLines(system, expandedPatterns, visibleFragments);
  const closure = semanticCarrierClosure(expandedPatterns, visibleLines);
  const patterns = expandedPatterns.filter(
    ({ patternId }) => visiblePatternIds.has(patternId) || closure.patternIds.has(patternId),
  );
  const includedServiceIds = new Set(patterns.map(({ service }) => service.id));
  const services = preselectedServices.filter(({ id }) => includedServiceIds.has(id));
  const includedPatternIds = new Set(patterns.map(({ patternId }) => patternId));
  const includedVisibleFragments = visibleFragments.filter(({ source }) =>
    includedPatternIds.has(source.patternId),
  );
  return {
    services,
    serviceIds: new Set(services.map(({ id }) => id)),
    lines: visibleLines.lines,
    patterns,
    physicalWayIds,
    visibleFragments: includedVisibleFragments,
    visibleSemanticFragmentIds: new Set(includedVisibleFragments.map(({ source }) => source.id)),
    semanticCarrierClosureFragmentIds: closure.fragmentIds,
  };
}
