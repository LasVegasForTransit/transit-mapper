import { mode } from './catalog';
import {
  nearestOnPath,
  oneSection,
  patternHasSplit,
  patternLegs,
  patternPath,
  patternWayIds,
  resolveWayPath,
  snap,
} from './geo';
import { resyncAutoNamedStations } from './geo/crossStreetNaming';
import { servicePattern, withServicePattern } from './line-service';
import { pruneSections, splitLegsAt } from './patternEdits';
import { materializeRouteSpans } from './routeLegs';
import { anchorOnWay, routeBetween, type RouteSpan } from './routeGraph';
import { reanchorStationsToReplacementWays } from './station-reanchoring';
import type { Line, LngLat, Pattern, PatternLeg, Service, TransitSystem } from './system';
import { removeWayFromSystem } from './way-removal';

const ADOPT_SNAP_M = 500;
const ADOPT_BIAS_WEIGHT = 2;
const ADOPT_STATION_REANCHOR_M = 300;
const RETURN_REJOIN_SNAP_M = 600;

interface AdoptionResult {
  system: TransitSystem;
  rebound: number;
}

/** Adds one routed operational Service under its public Line identity. */
export function withRoutedService(
  system: TransitSystem,
  line: Line,
  service: Service,
): TransitSystem {
  const riddenWayIds = new Set(patternLegs(servicePattern(service)).map((leg) => leg.wayId));
  return resyncAutoNamedStations(
    {
      ...system,
      lines: [...system.lines, line],
      services: [...system.services, service],
    },
    riddenWayIds,
  );
}

function coordAtSpanEnd(system: TransitSystem, span: RouteSpan): LngLat | null {
  const way = system.ways.find((candidate) => candidate.id === span.wayId);
  return way?.points[span.toPoint] ?? null;
}

function cutIndexOnLegs(
  system: TransitSystem,
  legs: PatternLeg[],
  coord: LngLat,
): { legIndex: number; t: number } | null {
  let bestIndex = -1;
  let bestT = 0;
  let bestDistance = Infinity;
  legs.forEach((leg, legIndex) => {
    const way = system.ways.find((candidate) => candidate.id === leg.wayId);
    if (!way) return;
    const path = resolveWayPath(way);
    if (path.length < 2) return;
    const nearest = nearestOnPath(path, coord);
    if (!nearest || nearest.distMeters >= bestDistance) return;
    bestIndex = legIndex;
    bestT = nearest.t;
    bestDistance = nearest.distMeters;
  });
  return bestIndex >= 0 && bestDistance <= RETURN_REJOIN_SNAP_M
    ? { legIndex: bestIndex, t: bestT }
    : null;
}

/** Adds a materialized return path, preserving the input when it cannot rejoin. */
export function withReturnPath(
  system: TransitSystem,
  serviceId: string,
  patternId: string,
  spans: RouteSpan[],
): TransitSystem {
  const service = system.services.find((candidate) => candidate.id === serviceId);
  const pattern = service?.id === patternId ? servicePattern(service) : undefined;
  if (!service || !pattern || spans.length === 0) return system;
  const returnLegs = materializeRouteSpans(system, spans);
  if (!returnLegs || returnLegs.length === 0) return system;

  const rejoin = spans[spans.length - 1];
  const endCoord = rejoin.toCoord ?? coordAtSpanEnd(system, rejoin);
  const outward = patternLegs(pattern);
  const cut = endCoord ? cutIndexOnLegs(system, outward, endCoord) : null;
  if (!cut) return system;

  const [shared, diverged] = splitLegsAt(outward, cut.legIndex, cut.t);
  const sections = pruneSections(
    diverged.length === 0
      ? [...oneSection(outward), { kind: 'turnaround' as const, legs: returnLegs }]
      : [
          ...(shared.length > 0 ? oneSection(shared) : []),
          { kind: 'split' as const, outbound: diverged, inbound: returnLegs },
        ],
  );
  const services = system.services.map((candidate) =>
    candidate.id !== serviceId
      ? candidate
      : withServicePattern(candidate, { ...pattern, sections }),
  );
  return resyncAutoNamedStations(
    { ...system, services },
    new Set(returnLegs.map((leg) => leg.wayId)),
  );
}

interface RoutedAdoption {
  oldWayIds: string[];
  adoptedLegs: PatternLeg[];
}

function routedAdoption(
  system: TransitSystem,
  pattern: Pattern,
  allowed: Set<string>,
): RoutedAdoption | null {
  if (patternHasSplit(pattern)) return null;
  const oldWayIds = [...new Set(patternWayIds(pattern))];
  const sketchPath = patternPath(system.ways, pattern);
  if (sketchPath.length < 2) return null;
  const excluded = new Set(oldWayIds);
  const candidates = system.ways.filter((way) => allowed.has(way.typeId) && !excluded.has(way.id));
  const start = snap(candidates, sketchPath[0], ADOPT_SNAP_M);
  const end = snap(candidates, sketchPath[sketchPath.length - 1], ADOPT_SNAP_M);
  if (!start || !end) return null;
  const startWay = system.ways.find((way) => way.id === start.wayId);
  const endWay = system.ways.find((way) => way.id === end.wayId);
  if (!startWay || !endWay) return null;
  const from = anchorOnWay(startWay, start.coord);
  const to = anchorOnWay(endWay, end.coord);
  if (!from || !to) return null;
  const routed = routeBetween(system, from, to, {
    allowedTypeIds: allowed,
    excludeWayIds: excluded,
    biasPath: sketchPath,
    biasWeight: ADOPT_BIAS_WEIGHT,
    travel: 'preferLegal',
  });
  const adoptedLegs = routed ? materializeRouteSpans(system, routed.spans) : null;
  return adoptedLegs ? { oldWayIds, adoptedLegs } : null;
}

function withAdoptedPattern(
  system: TransitSystem,
  serviceId: string,
  patternId: string,
  adoption: RoutedAdoption,
): TransitSystem {
  const excluded = new Set(adoption.oldWayIds);
  const adoptedWayIds = new Set(adoption.adoptedLegs.map((leg) => leg.wayId));
  return {
    ...system,
    services: system.services.map((service) =>
      service.id !== serviceId
        ? service
        : withServicePattern(service, {
            ...servicePattern(service),
            id: patternId,
            sections: oneSection(adoption.adoptedLegs),
          }),
    ),
    stations: reanchorStationsToReplacementWays(system, {
      replacedWayIds: excluded,
      replacementWayIds: adoptedWayIds,
      maxDistanceM: ADOPT_STATION_REANCHOR_M,
    }),
  };
}

function withoutUnusedSketchWays(system: TransitSystem, oldWayIds: string[]): TransitSystem {
  let next = system;
  for (const oldWayId of oldWayIds) {
    const oldWay = next.ways.find((way) => way.id === oldWayId);
    if (!oldWay || oldWay.source) continue;
    const ridden = next.services.some((service) =>
      patternLegs(servicePattern(service)).some((leg) => leg.wayId === oldWayId),
    );
    const named = next.namedWays.some((namedWay) => namedWay.wayIds.includes(oldWayId));
    if (!ridden && !named) next = removeWayFromSystem(next, oldWayId);
  }
  return next;
}

function adoptPattern(
  system: TransitSystem,
  serviceId: string,
  pattern: Pattern,
  allowed: Set<string>,
): TransitSystem | null {
  const adoption = routedAdoption(system, pattern, allowed);
  if (!adoption) return null;
  const rebound = withAdoptedPattern(system, serviceId, pattern.id, adoption);
  return withoutUnusedSketchWays(rebound, adoption.oldWayIds);
}

/** Rebinds one compatible sketch Service onto nearby, already-built ways. */
export function adoptExistingInfrastructure(
  system: TransitSystem,
  serviceId: string,
): AdoptionResult {
  const service = system.services.find((candidate) => candidate.id === serviceId);
  if (!service) return { system, rebound: 0 };
  const allowed = new Set(mode(service.modeId).wayTypeIds);
  const adopted = adoptPattern(system, serviceId, servicePattern(service), allowed);
  return adopted ? { system: adopted, rebound: 1 } : { system, rebound: 0 };
}
