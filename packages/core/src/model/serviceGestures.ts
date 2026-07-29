import { mode } from './catalog';
import {
  haversineMeters,
  legRange,
  nearestInsertionPoint,
  patternRunLegs,
  patternWayIds,
  pointAtT,
  resolveWayPath,
} from './geo';
import { anchorOnWay, routeBetween, type RouteSpan } from './routeGraph';
import type { PatternPosition } from './serviceEdits';
import type { LngLat, Node, Pattern, TransitSystem, Way } from './system';

export interface TerminusGestureSource {
  serviceId: string;
  patternId: string;
  side: 'start' | 'end';
  purpose: 'extend' | 'return';
}

export type TerminusGestureTarget =
  | { kind: 'corridor'; wayId: string; coord: LngLat }
  | {
      kind: 'service-position';
      serviceId: string;
      position: PatternPosition;
      terminus?: { patternId: string; side: 'start' | 'end' };
    };

export type TerminusGestureKind =
  'extend' | 'loop' | 'return' | 'connect' | 'connection-choice' | 'refuse';

export interface TerminusGesturePlan {
  kind: TerminusGestureKind;
  /** Immutable snapshot this plan was computed from. A chooser commit refuses
   * if any intervening edit replaced it. */
  baseSystem: TransitSystem;
  system: TransitSystem;
  spans: RouteSpan[];
  reason?:
    'missing-source' | 'missing-target' | 'different-mode' | 'incompatible-corridor' | 'unroutable';
  targetServiceId?: string;
}

const COINCIDENT_M = 0.75;
const POSITION_EPSILON = 1e-9;

function isInteriorOutboundPosition(pattern: Pattern, position: PatternPosition): boolean {
  if (position.patternId !== pattern.id || position.run !== 'outbound') return false;
  const run = patternRunLegs(pattern, 'outbound');
  const entry = run[position.legIndex];
  if (!entry || entry.leg.wayId !== position.wayId) return false;
  const [lo, hi] = legRange(entry.leg);
  const startT = entry.forward ? lo : hi;
  const endT = entry.forward ? hi : lo;
  const atPatternStart =
    position.legIndex === 0 && Math.abs(position.t - startT) <= POSITION_EPSILON;
  const atPatternEnd =
    position.legIndex === run.length - 1 && Math.abs(position.t - endT) <= POSITION_EPSILON;
  return !atPatternStart && !atPatternEnd;
}

function shiftRefs(nodes: Node[], wayId: string, index: number): Node[] {
  return nodes.map((node) => ({
    ...node,
    refs: node.refs.map((ref) =>
      ref.wayId === wayId && ref.pointIndex >= index
        ? { ...ref, pointIndex: ref.pointIndex + 1 }
        : ref,
    ),
  }));
}

function armAt(
  system: TransitSystem,
  wayId: string,
  coord: LngLat,
): { system: TransitSystem; pointIndex: number; coord: LngLat } | null {
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way) return null;
  const existing = way.points.findIndex((point) => haversineMeters(point, coord) <= COINCIDENT_M);
  if (existing >= 0) return { system, pointIndex: existing, coord: way.points[existing] };
  const insertion = nearestInsertionPoint(way.points, coord);
  if (!insertion || haversineMeters(insertion.coord, coord) > COINCIDENT_M) return null;
  const ways = system.ways.map((candidate) =>
    candidate.id === wayId
      ? {
          ...candidate,
          points: [
            ...candidate.points.slice(0, insertion.index),
            insertion.coord,
            ...candidate.points.slice(insertion.index),
          ],
        }
      : candidate,
  );
  return {
    system: {
      ...system,
      ways,
      nodes: shiftRefs(system.nodes, wayId, insertion.index),
    },
    pointIndex: insertion.index,
    coord: insertion.coord,
  };
}

/**
 * Add one explicit junction without applying the automatic crossing rules.
 * The caller already established that the service mode permits both corridor
 * types; this helper only makes the exact chosen point topological.
 */
export function connectWaysAt(
  system: TransitSystem,
  firstWayId: string,
  secondWayId: string,
  coord: LngLat,
): TransitSystem | null {
  if (firstWayId === secondWayId) return system;
  const firstWay = system.ways.find((way) => way.id === firstWayId);
  const secondWay = system.ways.find((way) => way.id === secondWayId);
  if (!firstWay || !secondWay || firstWay.grade !== secondWay.grade) return null;
  const first = armAt(system, firstWayId, coord);
  if (!first) return null;
  const second = armAt(first.system, secondWayId, first.coord);
  if (!second) return null;

  const refs = [
    { wayId: firstWayId, pointIndex: first.pointIndex },
    { wayId: secondWayId, pointIndex: second.pointIndex },
  ];
  const existing = second.system.nodes.find((node) =>
    node.refs.some(
      (ref) =>
        (ref.wayId === firstWayId && ref.pointIndex === first.pointIndex) ||
        (ref.wayId === secondWayId && ref.pointIndex === second.pointIndex),
    ),
  );
  const nodes = existing
    ? second.system.nodes.map((node) =>
        node.id === existing.id
          ? {
              ...node,
              refs: [
                ...node.refs,
                ...refs.filter(
                  (candidate) =>
                    !node.refs.some(
                      (ref) =>
                        ref.wayId === candidate.wayId && ref.pointIndex === candidate.pointIndex,
                    ),
                ),
              ],
            }
          : node,
      )
    : [
        ...second.system.nodes,
        {
          id: uniqueJunctionId(second.system, firstWayId, secondWayId),
          coord: second.coord,
          refs,
        },
      ];
  return { ...second.system, nodes };
}

function uniqueJunctionId(system: TransitSystem, firstWayId: string, secondWayId: string): string {
  const base = `junction-${firstWayId}-${secondWayId}`;
  let id = base;
  let suffix = 2;
  while (system.nodes.some((node) => node.id === id)) id = `${base}-${suffix++}`;
  return id;
}

function terminusAnchor(
  system: TransitSystem,
  source: TerminusGestureSource,
): { way: Way; coord: LngLat } | null {
  const service = system.services.find((candidate) => candidate.id === source.serviceId);
  const pattern = service?.patterns.find((candidate) => candidate.id === source.patternId);
  if (!pattern) return null;
  const run = patternRunLegs(pattern, 'outbound');
  const entry = source.side === 'start' ? run[0] : run[run.length - 1];
  const way = entry && system.ways.find((candidate) => candidate.id === entry.leg.wayId);
  if (!entry || !way) return null;
  const [lo, hi] = legRange(entry.leg);
  const t = (source.side === 'start') === entry.forward ? lo : hi;
  return { way, coord: pointAtT(resolveWayPath(way), t) };
}

function targetAnchor(
  system: TransitSystem,
  target: TerminusGestureTarget,
): { way: Way; coord: LngLat } | null {
  const wayId = target.kind === 'corridor' ? target.wayId : target.position.wayId;
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way) return null;
  return {
    way,
    coord:
      target.kind === 'corridor' ? target.coord : pointAtT(resolveWayPath(way), target.position.t),
  };
}

function alternateLoopAnchor(
  system: TransitSystem,
  coord: LngLat,
  excludedWayIds: Set<string>,
  allowedTypeIds: Set<string>,
): ReturnType<typeof anchorOnWay> {
  for (const way of system.ways) {
    if (excludedWayIds.has(way.id) || !allowedTypeIds.has(way.typeId)) continue;
    const at = anchorOnWay(way, coord);
    if (at && haversineMeters(at.coord, coord) <= COINCIDENT_M) return at;
  }
  return null;
}

/**
 * Resolve the legal, stateless route represented by one terminus drag.
 * Presentation and commit consume this same plan; no TransitSystem changes
 * until the caller explicitly commits the returned system and spans.
 */
export function planTerminusGesture(
  system: TransitSystem,
  source: TerminusGestureSource,
  target: TerminusGestureTarget,
): TerminusGesturePlan {
  const service = system.services.find((candidate) => candidate.id === source.serviceId);
  const pattern = service?.patterns.find((candidate) => candidate.id === source.patternId);
  const from = terminusAnchor(system, source);
  if (!service || !pattern || !from)
    return { kind: 'refuse', reason: 'missing-source', baseSystem: system, system, spans: [] };

  const targetService =
    target.kind === 'service-position'
      ? system.services.find((candidate) => candidate.id === target.serviceId)
      : undefined;
  if (target.kind === 'service-position' && !targetService)
    return { kind: 'refuse', reason: 'missing-target', baseSystem: system, system, spans: [] };
  if (targetService && targetService.modeId !== service.modeId)
    return { kind: 'refuse', reason: 'different-mode', baseSystem: system, system, spans: [] };
  if (
    source.purpose === 'return' &&
    !(
      target.kind === 'service-position' &&
      target.serviceId === source.serviceId &&
      isInteriorOutboundPosition(pattern, target.position)
    )
  )
    return { kind: 'refuse', reason: 'missing-target', baseSystem: system, system, spans: [] };

  const to = targetAnchor(system, target);
  if (!to)
    return { kind: 'refuse', reason: 'missing-target', baseSystem: system, system, spans: [] };
  const allowed = new Set(mode(service.modeId).wayTypeIds);
  if (!allowed.has(from.way.typeId) || !allowed.has(to.way.typeId))
    return {
      kind: 'refuse',
      reason: 'incompatible-corridor',
      baseSystem: system,
      system,
      spans: [],
    };

  let routedSystem = system;
  if (from.way.id !== to.way.id && haversineMeters(from.coord, to.coord) <= COINCIDENT_M) {
    routedSystem = connectWaysAt(system, from.way.id, to.way.id, to.coord) ?? system;
  }
  const routedFromWay = routedSystem.ways.find((way) => way.id === from.way.id);
  const routedToWay = routedSystem.ways.find((way) => way.id === to.way.id);
  const fromAnchor = routedFromWay && anchorOnWay(routedFromWay, from.coord);
  const toAnchor = routedToWay && anchorOnWay(routedToWay, to.coord);
  if (!fromAnchor || !toAnchor)
    return { kind: 'refuse', reason: 'unroutable', baseSystem: system, system, spans: [] };

  const sameBranch =
    target.kind === 'service-position' &&
    target.serviceId === source.serviceId &&
    target.position.patternId === source.patternId;
  const excluded = sameBranch ? new Set(patternWayIds(pattern)) : null;
  const routeFrom = excluded && alternateLoopAnchor(routedSystem, from.coord, excluded, allowed);
  const routeTo = excluded && alternateLoopAnchor(routedSystem, to.coord, excluded, allowed);
  const route =
    sameBranch && (!routeFrom || !routeTo)
      ? null
      : routeBetween(routedSystem, routeFrom ?? fromAnchor, routeTo ?? toAnchor, {
          allowedTypeIds: allowed,
          travel: 'legal',
          ...(excluded ? { excludeWayIds: excluded } : {}),
        });
  const spans = route?.spans ?? [];
  const zeroLengthConnection =
    targetService !== undefined && haversineMeters(from.coord, to.coord) <= COINCIDENT_M;
  if (spans.length === 0 && !zeroLengthConnection)
    return { kind: 'refuse', reason: 'unroutable', baseSystem: system, system, spans: [] };

  const kind: TerminusGestureKind =
    source.purpose === 'return'
      ? 'return'
      : sameBranch
        ? 'loop'
        : targetService
          ? target.kind === 'service-position' && target.terminus
            ? 'connection-choice'
            : 'connect'
          : 'extend';
  return {
    kind,
    baseSystem: system,
    system: routedSystem,
    spans,
    ...(targetService ? { targetServiceId: targetService.id } : {}),
  };
}
