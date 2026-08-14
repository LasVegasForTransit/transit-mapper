/**
 * Resolves the physical lane occupied by each directional service run.
 *
 * This belongs beside rendering because it turns route topology into a draw
 * assignment, but it remains independent of feature construction. The live
 * map, SVG, and vehicle geometry can therefore agree on the same answer:
 * which lane a rider actually uses on this particular way.
 */
import { PATTERN_RUNS, patternRunLegs, serviceLaneOnWay } from '../model/geo';
import type { ComponentMap } from '../model/components';
import type { Pattern, RunDirection, Service, TurnRestriction, Way } from '../model/system';
import type { LanePath } from '../geometry/streets';

/** One directional traversal of a way, pre-indexed so a visible corridor does
 * not need to scan every pattern in the document just to find its riders. */
export interface WayPatternEntry {
  readonly service: Service;
  readonly pattern: Pattern;
  readonly run: RunDirection;
  readonly wayIndex: number;
  readonly forward: boolean;
  /** The route's next way, when this traversal continues through a junction.
   * It lets lane resolution honour the turn restriction at that junction. */
  readonly nextWayId?: string;
}

export interface LaneServiceAssignmentOptions {
  readonly entries: readonly WayPatternEntry[];
  readonly laneById: ReadonlyMap<string, LanePath>;
  readonly waysById: Map<string, Way>;
  readonly turnRestrictions: ComponentMap<TurnRestriction>;
}

export interface LaneServiceAssignments {
  readonly servicesByLane: Map<string, Service[]>;
  readonly runsByLaneAndService: Map<string, Set<RunDirection>>;
  readonly resolvedServiceIds: Set<string>;
}

const indexCache = new WeakMap<Map<string, Service[]>, Map<string, WayPatternEntry[]>>();

/** Builds the document-wide route index once for an immutable services-by-way
 * map. Entries are directional because the return trip can legally occupy the
 * opposite curb lane, even when both runs share one authored pattern leg. */
export function indexServicePatternsByWay(
  servicesByWay: Map<string, Service[]>,
): Map<string, WayPatternEntry[]> {
  const cached = indexCache.get(servicesByWay);
  if (cached) return cached;

  const indexed = new Map<string, WayPatternEntry[]>();
  const seenServiceIds = new Set<string>();
  for (const candidateServices of servicesByWay.values()) {
    for (const service of candidateServices) {
      if (seenServiceIds.has(service.id)) continue;
      seenServiceIds.add(service.id);
      for (const run of PATTERN_RUNS) {
        const legs = patternRunLegs(service.path, run);
        legs.forEach(({ leg, index: wayIndex, forward }, legPosition) => {
          const entries = indexed.get(leg.wayId) ?? [];
          if (!indexed.has(leg.wayId)) indexed.set(leg.wayId, entries);
          const nextWayId = legs[legPosition + 1]?.leg.wayId;
          entries.push({
            service,
            pattern: service.path,
            run,
            wayIndex,
            forward,
            ...(nextWayId ? { nextWayId } : {}),
          });
        });
      }
    }
  }
  indexCache.set(servicesByWay, indexed);
  return indexed;
}

/**
 * Separates two scalar identifiers in a cache key. Centralising this keeps an
 * implementation detail out of render loops and lets callers state what the
 * key means: the runs of one service while it occupies one lane.
 */
export function laneServiceAssignmentKey(laneId: string, serviceId: string): string {
  return `${laneId}\u001f${serviceId}`;
}

/**
 * Groups visible service traversals by their resolved physical lane.
 *
 * A service may occupy the same lane in multiple runs or patterns, but it is
 * emitted once for that lane; the run set preserves the exact directional
 * identity needed by hit surfaces and junction connectors.
 */
export function assignServicesToLanes({
  entries,
  laneById,
  waysById,
  turnRestrictions,
}: LaneServiceAssignmentOptions): LaneServiceAssignments {
  const servicesByLane = new Map<string, Service[]>();
  const runsByLaneAndService = new Map<string, Set<RunDirection>>();
  const resolvedServiceIds = new Set<string>();

  for (const { service, pattern, run, wayIndex, forward, nextWayId } of entries) {
    const laneId = serviceLaneOnWay(
      pattern,
      wayIndex,
      waysById,
      service.modeId,
      forward,
      nextWayId ? { nextWayId, turnRestrictions } : undefined,
    );
    if (!laneId || !laneById.has(laneId)) continue;

    resolvedServiceIds.add(service.id);
    const services = servicesByLane.get(laneId) ?? [];
    if (!servicesByLane.has(laneId)) servicesByLane.set(laneId, services);

    const key = laneServiceAssignmentKey(laneId, service.id);
    const runs = runsByLaneAndService.get(key) ?? new Set<RunDirection>();
    if (!runsByLaneAndService.has(key)) runsByLaneAndService.set(key, runs);
    runs.add(run);

    if (!services.some((candidate) => candidate.id === service.id)) services.push(service);
  }

  return { servicesByLane, runsByLaneAndService, resolvedServiceIds };
}
