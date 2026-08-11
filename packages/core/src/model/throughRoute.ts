/**
 * Joining two lines that meet end to end into one line that runs the whole
 * way through.
 *
 * This is not a public Line grouping operation. Grouping preserves both
 * Services; a through-route combines their paths into one continuous ride.
 *
 * The join is only offered where a vehicle could actually make it: if the two
 * termini are not the same point, the router has to find a path between them
 * over compatible infrastructure, and that path becomes part of the joined
 * line. Concatenating across a gap instead would produce a pattern that
 * validateSystemQuick immediately reports as broken, which is a worse answer
 * than declining.
 */

import { mode } from './catalog';
import {
  haversineMeters,
  patternPath,
  legRunsWithPoints,
  patternLegs,
  oneSection,
  patternHasSplit,
} from './geo';
import { materializeRouteSpans } from './routeLegs';
import { anchorOnWay, routeBetween } from './routeGraph';
import { servicePattern } from './line-service';
import { removeGroupMembers } from './system/group';
import type { Pattern, PatternLeg, Service, TransitSystem, Way } from './system';
import { LEG_JOIN_TOLERANCE_M } from './validate';
import { terminiMeet, type TerminusMeeting } from './selectionRelations';

/** A leg list traversed the other way round: the order reverses, and each
 *  leg's direction of travel flips. The extent is left alone — it measures
 *  along the WAY's own path, not along travel, so which end of the stretch you
 *  enter first is exactly what `direction` says. */
function reverseLegs(legs: PatternLeg[]): PatternLeg[] {
  return [...legs].reverse().map((leg) => ({
    ...leg,
    direction: legRunsWithPoints(leg) ? ('againstPoints' as const) : ('withPoints' as const),
  }));
}

/** Legs oriented so that `end` is the last thing travelled. */
function legsEndingAt(pattern: Pattern, end: 'start' | 'end'): PatternLeg[] {
  return end === 'end' ? patternLegs(pattern) : reverseLegs(patternLegs(pattern));
}

/** Legs oriented so that `end` is the first thing travelled. */
function legsStartingAt(pattern: Pattern, end: 'start' | 'end'): PatternLeg[] {
  return end === 'start' ? patternLegs(pattern) : reverseLegs(patternLegs(pattern));
}

function terminusCoord(system: TransitSystem, pattern: Pattern, end: 'start' | 'end') {
  const path = patternPath(system.ways, pattern);
  if (path.length < 2) return null;
  return end === 'start' ? path[0] : path[path.length - 1];
}

function wayAtEnd(
  system: TransitSystem,
  legs: PatternLeg[],
  end: 'start' | 'end',
): Way | undefined {
  const leg = end === 'start' ? legs[0] : legs[legs.length - 1];
  return system.ways.find((way) => way.id === leg.wayId);
}

/**
 * The legs that carry a vehicle from one Service's terminus to the other's,
 * or null when nothing connects them. An empty array means the termini are
 * already the same point and no connector is needed.
 */
function connectorLegs(
  system: TransitSystem,
  service: Service,
  from: { pattern: Pattern; end: 'start' | 'end' },
  to: { pattern: Pattern; end: 'start' | 'end' },
): PatternLeg[] | null {
  const fromCoord = terminusCoord(system, from.pattern, from.end);
  const toCoord = terminusCoord(system, to.pattern, to.end);
  if (!fromCoord || !toCoord) return null;
  if (haversineMeters(fromCoord, toCoord) <= LEG_JOIN_TOLERANCE_M) return [];

  const fromWay = wayAtEnd(system, patternLegs(from.pattern), from.end);
  const toWay = wayAtEnd(system, patternLegs(to.pattern), to.end);
  if (!fromWay || !toWay) return null;
  const fromAnchor = anchorOnWay(fromWay, fromCoord);
  const toAnchor = anchorOnWay(toWay, toCoord);
  if (!fromAnchor || !toAnchor) return null;

  const res = routeBetween(system, fromAnchor, toAnchor, {
    allowedTypeIds: new Set(mode(service.modeId).wayTypeIds),
  });
  return res ? materializeRouteSpans(system, res.spans) : null;
}

/**
 * Join `otherId` onto `keepId` as one continuous Service.
 *
 * The joined Service keeps `keepId`'s name and schedule because it is one of
 * the two existing operations carrying on. Its public Line also survives with
 * its rider-facing name and colour.
 *
 * Returns null and changes nothing when the modes differ, when the termini do
 * not meet, or when no infrastructure connects them.
 */
export function throughRouteServices(
  system: TransitSystem,
  keepId: string,
  otherId: string,
): TransitSystem | null {
  const meeting: TerminusMeeting | null = terminiMeet(system, keepId, otherId);
  return meeting ? throughRouteServicesAt(system, keepId, otherId, meeting) : null;
}

/**
 * Exact counterpart for a terminus gesture. Unlike throughRouteServices,
 * this never substitutes a closer branch for the branch and ends the person
 * actually connected in the anchored preview.
 */
export function throughRouteServicesAt(
  system: TransitSystem,
  keepId: string,
  otherId: string,
  meeting: TerminusMeeting,
): TransitSystem | null {
  const keep = system.services.find((s) => s.id === keepId);
  const other = system.services.find((s) => s.id === otherId);
  if (!keep || !other || keep.id === other.id || keep.modeId !== other.modeId) return null;

  if (keep.id !== meeting.aPatternId || other.id !== meeting.bPatternId) return null;
  const keepPattern = servicePattern(keep);
  const otherPattern = servicePattern(other);
  // A line whose two directions run different streets cannot be spliced into
  // the middle of another one: the joint is where the two halves of a couplet
  // would have to be re-paired against the other line's, and nothing here
  // knows how to do that. Refusing beats flattening it silently, which is what
  // building one undivided leg list out of it would amount to.
  if (patternHasSplit(keepPattern) || patternHasSplit(otherPattern)) return null;

  const connector = connectorLegs(
    system,
    keep,
    { pattern: keepPattern, end: meeting.aEnd },
    { pattern: otherPattern, end: meeting.bEnd },
  );
  if (!connector) return null;

  // One undivided stretch, safely: a couplet on either side was refused above.
  const joined: Pattern = {
    ...keepPattern,
    sections: oneSection([
      ...legsEndingAt(keepPattern, meeting.aEnd),
      ...connector,
      ...legsStartingAt(otherPattern, meeting.bEnd),
    ]),
  };

  const services = system.services
    .filter((s) => s.id !== otherId)
    .map((s) =>
      s.id === keepId
        ? {
            ...s,
            path: {
              id: s.id,
              sections: joined.sections,
              ...(joined.skippedStops ? { skippedStops: joined.skippedStops } : {}),
            },
          }
        : s,
    );
  const lines = system.lines
    .map((line) => ({
      ...line,
      serviceIds: line.serviceIds.filter((serviceId) => serviceId !== otherId),
    }))
    .filter((line) => line.serviceIds.length > 0);
  const liveLineIds = new Set(lines.map((line) => line.id));
  const removedIds = new Set([
    otherId,
    ...system.lines.filter((line) => !liveLineIds.has(line.id)).map((line) => line.id),
  ]);
  return removeGroupMembers(
    {
      ...system,
      services,
      lines,
    },
    removedIds,
  );
}
