/**
 * How two selected objects relate to each other on the ground.
 *
 * These answer only "what is true about this pair" — never "what should the
 * app offer about it". Keeping the two apart is what lets the same crossing
 * test serve the menu, and lets every predicate be tested against a
 * hand-built system with no menu, store, or registry involved.
 *
 * Each predicate deliberately mirrors the guard of the operation it will
 * gate, so the app never offers a merge that the merge itself then refuses.
 * Where mirroring is impossible the comment says so.
 */

import {
  CONFLATION_TOLERANCE_M,
  densifyForMatching,
  detectShapeRuns,
  haversineMeters,
  patternPath,
  patternWayIds,
  resolveWayPath,
} from './geo';
import type { LngLat, Node, Pattern, Service, TransitSystem, Way } from './system';
import { polylineCrossings, type WayCrossing } from './validate';

/** How close two lines' ends must be to read as meeting. Two lines ending on
 *  opposite platforms of one station are a through-route waiting to happen;
 *  two ending a block apart are not. 100 m clears the longest station
 *  footprint the editor draws (a ~60 m default) with room for the walk
 *  between platforms, and falls well short of a city block. */
export const TERMINI_MEET_M = 100;

function wayOf(system: TransitSystem, id: string): Way | undefined {
  return system.ways.find((w) => w.id === id);
}

function serviceOf(system: TransitSystem, id: string): Service | undefined {
  return system.services.find((s) => s.id === id);
}

/**
 * The node that joins an open end of one way to an open end of the other, or
 * null. Exactly the shape splitWayAt leaves behind, and exactly what
 * mergeWays needs: a two-way node, both refs at an endpoint, both ways the
 * same type. A node with a third way meeting there is not a candidate,
 * because joining across it would silently swallow the junction.
 */
export function sharedEndpointNode(system: TransitSystem, aId: string, bId: string): Node | null {
  const a = wayOf(system, aId);
  const b = wayOf(system, bId);
  if (!a || !b || a.id === b.id || a.typeId !== b.typeId) return null;
  const isEndOf = (way: Way, index: number) => index === 0 || index === way.points.length - 1;
  return (
    system.nodes.find((n) => {
      if (n.refs.length !== 2) return false;
      const aRef = n.refs.find((r) => r.wayId === aId);
      const bRef = n.refs.find((r) => r.wayId === bId);
      if (!aRef || !bRef) return false;
      return isEndOf(a, aRef.pointIndex) && isEndOf(b, bRef.pointIndex);
    }) ?? null
  );
}

/**
 * Where two ways cross mid-span with nothing joining them, or null. Grade is
 * part of the question rather than a caveat on the answer: two ways at
 * different grades that overlap on the map are an overpass, and
 * formCrossingJunctions declines them for the same reason.
 *
 * Type is part of it for the same reason, mirroring sharedEndpointNode above
 * and formCrossingJunctions' own guard: a junction is a lane graph, and a
 * road meeting a rail line has no lanes to connect. Offering the join built
 * one anyway — a road and a rail service sharing a junction that is not a
 * station — so the predicate refuses the pair outright rather than leaving
 * the operation to catch it.
 */
export function crossingBetween(
  system: TransitSystem,
  aId: string,
  bId: string,
): WayCrossing | null {
  const a = wayOf(system, aId);
  const b = wayOf(system, bId);
  if (!a || !b || a.id === b.id || a.grade !== b.grade || a.typeId !== b.typeId) return null;
  return polylineCrossings(a.points, b.points)[0] ?? null;
}

/** True when the pair would cross but for their grades — the one fact worth
 *  telling someone who selected two streets that visibly overlap and was
 *  offered nothing. */
export function crossesAtDifferentGrades(system: TransitSystem, aId: string, bId: string): boolean {
  const a = wayOf(system, aId);
  const b = wayOf(system, bId);
  if (!a || !b || a.id === b.id || a.grade === b.grade) return false;
  return polylineCrossings(a.points, b.points).length > 0;
}

/**
 * True when `aId` runs along `bId` closely enough to be one corridor.
 *
 * This calls detectShapeRuns — the same matcher conflation uses to decide
 * what to absorb — rather than approximating it, so the app cannot offer a
 * corridor merge whose matcher then finds nothing. What it still cannot
 * promise is that the merge changes anything: mergeWaysIntoCorridor moves
 * SERVICES onto the keeper, so a co-aligned way carrying no service is left
 * where it is. Callers that gate a menu entry pair this with a carries-a-
 * service check.
 */
export function runsAlongside(
  system: TransitSystem,
  aId: string,
  bId: string,
  /** How far apart the two may be. The default is the automatic tolerance,
   *  which is right for deciding whether to OFFER an ordinary corridor merge.
   *  Asking "is this street a duplicate of that one" needs a wider band on
   *  purpose: a duplicate only exists because it fell outside the automatic
   *  tolerance, so judging the recovery by that same number guarantees it is
   *  never offered. */
  toleranceM: number = CONFLATION_TOLERANCE_M,
): boolean {
  const a = wayOf(system, aId);
  const b = wayOf(system, bId);
  if (!a || !b || a.id === b.id) return false;
  const path = densifyForMatching(resolveWayPath(a), toleranceM);
  if (path.length < 2) return false;
  return detectShapeRuns(path, [b], { toleranceM, minRunM: toleranceM * 1.25 }).some(
    (run) => 'onWayId' in run,
  );
}

/** True when any pattern of the service rides this way. */
export function serviceRidesWay(service: Service, wayId: string): boolean {
  return service.patterns.some((p) => patternWayIds(p).includes(wayId));
}

/** True when a service somewhere in the system rides this way. */
export function wayCarriesService(system: TransitSystem, wayId: string): boolean {
  return system.services.some((s) => serviceRidesWay(s, wayId));
}

/** Which end of a pattern meets which end of another, and how far apart. */
export interface TerminusMeeting {
  aPatternId: string;
  aEnd: 'start' | 'end';
  bPatternId: string;
  bEnd: 'start' | 'end';
  distanceM: number;
}

interface PatternTerminus {
  end: 'start' | 'end';
  coord: LngLat;
}

function patternTermini(system: TransitSystem, pattern: Pattern): PatternTerminus[] {
  const path = patternPath(system.ways, pattern);
  if (path.length < 2) return [];
  return [
    { end: 'start', coord: path[0] },
    { end: 'end', coord: path[path.length - 1] },
  ];
}

/**
 * The closest pair of termini between two services, if they meet at all.
 * Mode is not checked here — that is a property of the services, not a
 * relationship between them, and the provider that offers the join reports it
 * separately.
 */
export function terminiMeet(
  system: TransitSystem,
  aServiceId: string,
  bServiceId: string,
): TerminusMeeting | null {
  const a = serviceOf(system, aServiceId);
  const b = serviceOf(system, bServiceId);
  if (!a || !b || a.id === b.id) return null;
  let best: TerminusMeeting | null = null;
  for (const ap of a.patterns) {
    const aEnds = patternTermini(system, ap);
    for (const bp of b.patterns) {
      const bEnds = patternTermini(system, bp);
      for (const ae of aEnds) {
        for (const be of bEnds) {
          const distanceM = haversineMeters(ae.coord, be.coord);
          if (distanceM > TERMINI_MEET_M) continue;
          if (best && best.distanceM <= distanceM) continue;
          best = {
            aPatternId: ap.id,
            aEnd: ae.end,
            bPatternId: bp.id,
            bEnd: be.end,
            distanceM,
          };
        }
      }
    }
  }
  return best;
}

/**
 * True when two services share infrastructure or cross each other. Sharing a
 * way is checked first because it is a set intersection; the geometric
 * crossing test only runs when that finds nothing.
 */
export function servicesShareOrCross(
  system: TransitSystem,
  aServiceId: string,
  bServiceId: string,
): boolean {
  const a = serviceOf(system, aServiceId);
  const b = serviceOf(system, bServiceId);
  if (!a || !b || a.id === b.id) return false;

  const aWays = new Set(a.patterns.flatMap((p) => patternWayIds(p)));
  if (b.patterns.some((p) => patternWayIds(p).some((id) => aWays.has(id)))) return true;

  for (const ap of a.patterns) {
    const aPath = patternPath(system.ways, ap);
    if (aPath.length < 2) continue;
    for (const bp of b.patterns) {
      const bPath = patternPath(system.ways, bp);
      if (bPath.length < 2) continue;
      if (polylineCrossings(aPath, bPath).length > 0) return true;
    }
  }
  return false;
}
