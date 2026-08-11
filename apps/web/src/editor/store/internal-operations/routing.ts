import { mode } from '@transitmapper/core/model/catalog';
import {
  nearestOnPath,
  oneSection,
  patternHasSplit,
  patternLegs,
  patternPath,
  patternRunLegs,
  patternRunPath,
  patternWayIds,
  resolveWayPath,
  snap,
} from '@transitmapper/core/model/geo';
import { pruneSections, splitLegsAt } from '@transitmapper/core/model/patternEdits';
import { servicePattern, withServicePattern } from '@transitmapper/core/model/line-service';
import { materializeRouteSpans } from '@transitmapper/core/model/routeLegs';
import {
  anchorOnWay,
  routeBetween,
  type RouteAnchor,
  type RouteSpan,
} from '@transitmapper/core/model/routeGraph';
import type {
  LngLat,
  Line,
  Pattern,
  PatternLeg,
  Service,
  StationAnchor,
  TransitSystem,
} from '@transitmapper/core/model/system';
import { resyncAutoNamedStations } from '@transitmapper/core/model/geo/crossStreetNaming';
import type { RouteDraft } from '../state';

const ADOPT_SNAP_M = 500;
const ADOPT_BIAS_WEIGHT = 2;
const ADOPT_STATION_REANCHOR_M = 300;
const RETURN_REJOIN_SNAP_M = 600;

export interface RoutingInfrastructureOperations {
  readonly removeWay: (system: TransitSystem, wayId: string) => TransitSystem;
}

export interface AdoptionResult {
  system: TransitSystem;
  rebound: number;
}

interface DraftSpanJoin {
  spans: RouteSpan[];
  rest: RouteSpan[];
}

function joinedDraftSpans(existing: RouteSpan[], additions: RouteSpan[]): DraftSpanJoin | null {
  const spans = existing.map((span) => ({ ...span }));
  const previous = spans[spans.length - 1];
  const first = additions[0];
  if (spans.length === 0 || first.wayId !== previous.wayId) return { spans, rest: additions };
  if (previous.noInterior && first.noInterior) {
    if (previous.seg !== first.seg || !previous.toCoord || !first.toCoord) return null;
    previous.toCoord = first.toCoord;
    return { spans, rest: additions.slice(1) };
  }
  if (previous.noInterior || first.noInterior) return null;
  const previousDirection = Math.sign(previous.toPoint - previous.fromPoint);
  const nextDirection = Math.sign(first.toPoint - first.fromPoint);
  if (!previous.toCoord || !first.fromCoord || previousDirection !== nextDirection) return null;
  previous.toPoint = first.toPoint;
  previous.toCoord = first.toCoord;
  return { spans, rest: additions.slice(1) };
}

function repeatsWay(existing: RouteSpan[], additions: RouteSpan[]): boolean {
  const seen = new Set(existing.map((span) => span.wayId));
  return additions.some((span) => {
    if (seen.has(span.wayId)) return true;
    seen.add(span.wayId);
    return false;
  });
}

/** Extends a transient route draft without mutating its existing spans. */
export function extendedRouteDraft(
  system: TransitSystem,
  draft: RouteDraft,
  anchor: RouteAnchor,
): RouteDraft | null {
  const allowed = new Set(mode(draft.modeId).wayTypeIds);
  const routed = routeBetween(system, draft.lastAnchor, anchor, {
    allowedTypeIds: allowed,
    travel: 'preferLegal',
  });
  if (!routed || routed.spans.length === 0) return null;

  const joined = joinedDraftSpans(draft.spans, routed.spans);
  if (!joined) return null;
  // Reusing a way makes the draft's direction ambiguous until couplet-aware
  // drafting exists, so reject the extension instead of silently misjoining it.
  if (repeatsWay(joined.spans, joined.rest)) return null;
  return {
    ...draft,
    lastAnchor: anchor,
    spans: [...joined.spans, ...joined.rest.map((span) => ({ ...span }))],
  };
}

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

/** Adds a return path, preserving the input reference when it cannot rejoin. */
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

/** Builds the transient return draft from the outward run's real terminus. */
export function returnPathDraft(
  system: TransitSystem,
  serviceId: string,
  patternId: string,
): RouteDraft | null {
  const service = system.services.find((candidate) => candidate.id === serviceId);
  const pattern = service?.id === patternId ? servicePattern(service) : undefined;
  if (!service || !pattern) return null;
  const outward = patternRunPath(system.ways, pattern, 'outbound');
  if (outward.length < 2) return null;
  const run = patternRunLegs(pattern, 'outbound');
  const lastWayId = run[run.length - 1]?.leg.wayId;
  const way = system.ways.find((candidate) => candidate.id === lastWayId);
  const anchor = way ? anchorOnWay(way, outward[outward.length - 1]) : null;
  return anchor
    ? {
        modeId: service.modeId,
        lastAnchor: anchor,
        spans: [],
        returnFor: { serviceId, patternId },
      }
    : null;
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

function nearestAdoptedAnchor(
  system: TransitSystem,
  adoptedWayIds: Set<string>,
  coord: LngLat,
): StationAnchor | undefined {
  let best: StationAnchor | undefined;
  let bestDistance = ADOPT_STATION_REANCHOR_M;
  for (const way of system.ways) {
    if (!adoptedWayIds.has(way.id)) continue;
    const nearest = nearestOnPath(resolveWayPath(way), coord);
    if (!nearest || nearest.distMeters >= bestDistance) continue;
    bestDistance = nearest.distMeters;
    best = { wayId: way.id, t: nearest.t };
  }
  return best;
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
    stations: system.stations.map((station) => {
      if (!station.anchors.some((anchor) => excluded.has(anchor.wayId))) return station;
      const best = nearestAdoptedAnchor(system, adoptedWayIds, station.coord);
      const detached = station.anchors.filter((anchor) => !excluded.has(anchor.wayId));
      return best
        ? {
            ...station,
            anchors: [best, ...detached.filter((anchor) => anchor.wayId !== best.wayId)],
          }
        : { ...station, anchors: detached };
    }),
  };
}

function withoutUnusedSketchWays(
  system: TransitSystem,
  oldWayIds: string[],
  operations: RoutingInfrastructureOperations,
): TransitSystem {
  let next = system;
  for (const oldWayId of oldWayIds) {
    const oldWay = next.ways.find((way) => way.id === oldWayId);
    if (!oldWay || oldWay.source) continue;
    const ridden = next.services.some((service) =>
      patternLegs(servicePattern(service)).some((leg) => leg.wayId === oldWayId),
    );
    const named = next.namedWays.some((namedWay) => namedWay.wayIds.includes(oldWayId));
    if (!ridden && !named) next = operations.removeWay(next, oldWayId);
  }
  return next;
}

interface AdoptionContext {
  serviceId: string;
  allowed: Set<string>;
  operations: RoutingInfrastructureOperations;
}

function adoptPattern(
  system: TransitSystem,
  pattern: Pattern,
  context: AdoptionContext,
): TransitSystem | null {
  const adoption = routedAdoption(system, pattern, context.allowed);
  if (!adoption) return null;
  const rebound = withAdoptedPattern(system, context.serviceId, pattern.id, adoption);
  return withoutUnusedSketchWays(rebound, adoption.oldWayIds, context.operations);
}

/** Rebinds compatible sketch patterns onto nearby, already-built ways. */
export function adoptExistingInfrastructure(
  system: TransitSystem,
  serviceId: string,
  operations: RoutingInfrastructureOperations,
): AdoptionResult {
  const service = system.services.find((candidate) => candidate.id === serviceId);
  if (!service) return { system, rebound: 0 };
  const allowed = new Set(mode(service.modeId).wayTypeIds);
  const context = { serviceId, allowed, operations };
  const adopted = adoptPattern(system, servicePattern(service), context);
  return adopted ? { system: adopted, rebound: 1 } : { system, rebound: 0 };
}
