import { mode, wayType } from './catalog';
import {
  CONFLATION_TOLERANCE_M,
  densifyForMatching,
  detectShapeRuns,
  dropCollinearPoints,
  haversineMeters,
  oneSection,
  pathLengthMeters,
  patternLegs,
  patternPath,
  patternSegments,
  patternWayIds,
  wayById,
  wholeLeg,
  type ShapeRun,
} from './geo';
import { shortId } from './ids';
import { withServicePattern } from './line-service';
import { defaultProfileFor, makeOneWay } from './profile';
import { materializeRouteSpans } from './routeLegs';
import { anchorOnWay, routeBetween } from './routeGraph';
import { reanchorStationsOnWay, reanchorStationsToReplacementWays } from './station-reanchoring';
import { deleteSelection } from './selection-deletion';
import type { LngLat, Pattern, PatternLeg, TransitSystem, Way } from './system';

const JOIN_REUSE_TOLERANCE_M = 0.75;
const CORRIDOR_STATION_REANCHOR_M = 300;

export interface ReconcileImportedSystemResult {
  system: TransitSystem;
  reconciled: number;
}

type ConflatePatternArguments = [
  system: TransitSystem,
  serviceId: string,
  patternId: string,
  ontoWayIds?: ReadonlySet<string>,
  toleranceOverrideM?: number,
];

interface ConflationRequest {
  serviceId: string;
  patternId: string;
  ontoWayIds?: ReadonlySet<string>;
  toleranceOverrideM?: number;
}

interface ConflationPlan {
  oldWayIds: string[];
  path: LngLat[];
  wayTypeId: string;
  runs: ShapeRun[];
}

interface MaterializedRuns {
  system: TransitSystem;
  legs: PatternLeg[];
  mintedWayIds: Set<string>;
}

/**
 * Rebind one pattern onto compatible infrastructure it already follows.
 *
 * The transform is runtime-neutral and timestamp-neutral. The input reference
 * is returned when no corridor can be shared, so callers can avoid recording
 * a content mutation.
 */
export function conflatePatternOntoExisting(
  ...[system, serviceId, patternId, ontoWayIds, toleranceOverrideM]: ConflatePatternArguments
): TransitSystem {
  const request = { serviceId, patternId, ontoWayIds, toleranceOverrideM };
  const plan = buildConflationPlan(system, request);
  if (!plan || (plan.runs.length === 1 && 'fresh' in plan.runs[0])) return system;

  const materialized = materializeShapeRuns(system, plan);
  if (!materialized || materialized.legs.length === 0) return system;

  const rebound = replacePatternLegs(materialized.system, request, materialized.legs);
  const stitched = stitchFreshLegEnds(
    rebound,
    request.serviceId,
    request.patternId,
    materialized.mintedWayIds,
  );
  return removeUnusedOldWays(stitched, plan.oldWayIds, materialized.legs);
}

function buildConflationPlan(
  system: TransitSystem,
  request: ConflationRequest,
): ConflationPlan | null {
  const service = system.services.find((candidate) => candidate.id === request.serviceId);
  const pattern = service?.path.id === request.patternId ? service.path : undefined;
  if (!service || !pattern) return null;

  const oldWayIds = [...new Set(patternWayIds(pattern))];
  const rawPath = patternPath(system.ways, pattern);
  if (rawPath.length < 2) return null;
  const wayTypeId = system.ways.find((way) => way.id === oldWayIds[0])?.typeId;
  if (!wayTypeId) return null;

  const modeSpec = mode(service.modeId);
  const toleranceM =
    request.toleranceOverrideM ?? modeSpec.corridorToleranceM ?? CONFLATION_TOLERANCE_M;
  const path = densifyForMatching(rawPath, toleranceM);
  const allowedTypeIds = new Set(modeSpec.wayTypeIds);
  const excludedWayIds = new Set(oldWayIds);
  const candidates = system.ways.filter(
    (way) =>
      allowedTypeIds.has(way.typeId) &&
      !excludedWayIds.has(way.id) &&
      (!request.ontoWayIds || request.ontoWayIds.has(way.id)),
  );
  return {
    oldWayIds,
    path,
    wayTypeId,
    runs: detectShapeRuns(path, candidates, { toleranceM }),
  };
}

function materializeShapeRuns(
  system: TransitSystem,
  plan: ConflationPlan,
): MaterializedRuns | null {
  let next = system;
  const legs: PatternLeg[] = [];
  const mintedWayIds = new Set<string>();
  for (const run of plan.runs) {
    const materialized = materializeShapeRun(next, run, plan.path, plan.wayTypeId);
    if (!materialized) return null;
    if ('fresh' in run) {
      for (const leg of materialized.legs) mintedWayIds.add(leg.wayId);
    }
    next = materialized.system;
    legs.push(...materialized.legs);
  }
  return { system: next, legs, mintedWayIds };
}

function replacePatternLegs(
  system: TransitSystem,
  request: ConflationRequest,
  legs: PatternLeg[],
): TransitSystem {
  return {
    ...system,
    services: system.services.map((service) =>
      service.id === request.serviceId
        ? withServicePattern(service, { ...service.path, sections: oneSection(legs) })
        : service,
    ),
  };
}

function oldWayMustRemain(
  system: TransitSystem,
  oldWayId: string,
  newWayIds: Set<string>,
): boolean {
  if (newWayIds.has(oldWayId)) return true;
  const oldWay = system.ways.find((way) => way.id === oldWayId);
  if (!oldWay || oldWay.source) return true;
  if (system.namedWays.some((namedWay) => namedWay.wayIds.includes(oldWayId))) return true;
  return system.services.some((service) =>
    patternLegs(service.path).some((leg) => leg.wayId === oldWayId),
  );
}

function removeUnusedOldWays(
  system: TransitSystem,
  oldWayIds: string[],
  newLegs: PatternLeg[],
): TransitSystem {
  const newWayIds = new Set(newLegs.map((leg) => leg.wayId));
  const removedWayIds = new Set(
    oldWayIds.filter((oldWayId) => !oldWayMustRemain(system, oldWayId, newWayIds)),
  );
  const stations = reanchorStationsToReplacementWays(system, {
    replacedWayIds: removedWayIds,
    replacementWayIds: newWayIds,
    maxDistanceM: CORRIDOR_STATION_REANCHOR_M,
  });
  let next = stations === system.stations ? system : { ...system, stations };
  for (const oldWayId of removedWayIds) next = removeOrphanWay(next, oldWayId);
  return next;
}

/**
 * Reconcile imported patterns longest-first so a trunk establishes the
 * corridor that shorter overlapping services reuse.
 */
export function reconcileImportedSystem(
  system: TransitSystem,
  serviceIds: string[],
): ReconcileImportedSystemResult {
  let next = system;
  const targets: { serviceId: string; patternId: string; length: number }[] = [];
  for (const serviceId of serviceIds) {
    const service = next.services.find((candidate) => candidate.id === serviceId);
    if (!service) continue;
    targets.push({
      serviceId,
      patternId: service.path.id,
      length: pathLengthMeters(patternPath(next.ways, service.path)),
    });
  }
  targets.sort((a, b) => b.length - a.length);

  const establishedWayIds = new Set<string>();
  let reconciled = 0;
  for (const target of targets) {
    const reconciledSystem = conflatePatternOntoExisting(
      next,
      target.serviceId,
      target.patternId,
      establishedWayIds,
    );
    if (reconciledSystem !== next) {
      next = reconciledSystem;
      reconciled++;
    }
    const service = next.services.find((candidate) => candidate.id === target.serviceId);
    const pattern = service?.path.id === target.patternId ? service.path : undefined;
    for (const leg of pattern ? patternLegs(pattern) : []) establishedWayIds.add(leg.wayId);
  }

  return { system: next, reconciled };
}

function materializeShapeRun(
  system: TransitSystem,
  run: ShapeRun,
  path: LngLat[],
  wayTypeId: string,
): { system: TransitSystem; legs: PatternLeg[] } | null {
  const startCoord = path.at(run.fromIdx);
  const endCoord = path.at(run.toIdx);
  if (!startCoord || !endCoord) return null;

  if ('fresh' in run) {
    const points = dropCollinearPoints(path.slice(run.fromIdx, run.toIdx + 1));
    if (points.length < 2) return null;
    const wayId = shortId();
    const way: Way = {
      id: wayId,
      typeId: wayTypeId,
      points,
      geometry: 'straight',
      grade: 'atGrade',
      profile: makeOneWay(
        defaultProfileFor(wayTypeId, wayType(wayTypeId).importedCapacity),
        'forward',
      ),
    };
    return {
      system: { ...system, ways: [...system.ways, way] },
      legs: [wholeLeg(wayId)],
    };
  }

  const way = system.ways.find((candidate) => candidate.id === run.onWayId);
  if (!way) return null;
  const from = anchorOnWay(way, startCoord);
  const to = anchorOnWay(way, endCoord);
  if (!from || !to) return null;
  const route = routeBetween(system, from, to, {
    allowedTypeIds: new Set([way.typeId]),
    travel: 'legal',
  });
  if (!route) return null;
  const legs = materializeRouteSpans(system, route.spans);
  return legs ? { system, legs } : null;
}

function stitchFreshLegEnds(
  system: TransitSystem,
  serviceId: string,
  patternId: string,
  mintedWayIds: Set<string>,
): TransitSystem {
  if (mintedWayIds.size === 0) return system;
  let next = system;
  for (let guard = 0; guard < mintedWayIds.size + 1; guard++) {
    const service = next.services.find((candidate) => candidate.id === serviceId);
    const pattern = service?.path.id === patternId ? service.path : undefined;
    if (!pattern) return next;
    const target = freshLegMove(next, pattern, mintedWayIds);
    if (!target) return next;
    next = moveWayRunEnd(next, target);
  }
  return next;
}

interface WayRunEndMove {
  wayId: string;
  forward: boolean;
  atStart: boolean;
  coord: LngLat;
}

function gapMove(
  previous: ReturnType<typeof patternSegments>[number],
  current: ReturnType<typeof patternSegments>[number],
  mintedWayIds: Set<string>,
): WayRunEndMove | null {
  const previousEnd = previous.path[previous.path.length - 1];
  const currentStart = current.path[0];
  if (haversineMeters(previousEnd, currentStart) <= JOIN_REUSE_TOLERANCE_M) return null;
  if (mintedWayIds.has(current.leg.wayId)) {
    return {
      wayId: current.leg.wayId,
      forward: current.forward,
      atStart: true,
      coord: previousEnd,
    };
  }
  return mintedWayIds.has(previous.leg.wayId)
    ? {
        wayId: previous.leg.wayId,
        forward: previous.forward,
        atStart: false,
        coord: currentStart,
      }
    : null;
}

function freshLegMove(
  system: TransitSystem,
  pattern: Pattern,
  mintedWayIds: Set<string>,
): WayRunEndMove | null {
  const segments = patternSegments(wayById(system.ways), pattern);
  for (let index = 1; index < segments.length; index++) {
    const target = gapMove(segments[index - 1], segments[index], mintedWayIds);
    if (target) return target;
  }
  return null;
}

function moveWayRunEnd(system: TransitSystem, target: WayRunEndMove): TransitSystem {
  const way = system.ways.find((candidate) => candidate.id === target.wayId);
  if (!way) return system;
  const atFirstPoint = target.atStart === target.forward;
  const points = [...way.points];
  points[atFirstPoint ? 0 : points.length - 1] = target.coord;
  const nextWay = { ...way, points };
  const ways = system.ways.map((candidate) => (candidate === way ? nextWay : candidate));
  const withWay = { ...system, ways };
  const stations = reanchorStationsOnWay(withWay, target.wayId);
  return { ...withWay, stations };
}

function removeOrphanWay(system: TransitSystem, wayId: string): TransitSystem {
  if (
    system.services.some((service) => patternLegs(service.path).some((leg) => leg.wayId === wayId))
  ) {
    return system;
  }

  return deleteSelection(system, [{ kind: 'way', id: wayId }]);
}
