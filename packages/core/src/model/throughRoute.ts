/**
 * Joining two lines that meet end to end into one line that runs the whole
 * way through.
 *
 * This is not what mergeServiceInto does. That makes one service carrying two
 * disjoint patterns — a branched line — which is the right model for a trunk
 * that splits, and the wrong one for two routes that ought to be through-
 * routed into a single ride.
 *
 * The join is only offered where a vehicle could actually make it: if the two
 * termini are not the same point, the router has to find a path between them
 * over compatible infrastructure, and that path becomes part of the joined
 * line. Concatenating across a gap instead would produce a pattern that
 * validateSystemQuick immediately reports as broken, which is a worse answer
 * than declining.
 */

import { mode } from './catalog';
import { haversineMeters, patternPath } from './geo';
import { materializeRouteSpans } from './routeLegs';
import { anchorOnWay, routeBetween } from './routeGraph';
import type { Pattern, PatternLeg, Service, TransitSystem, Way } from './system';
import { LEG_JOIN_TOLERANCE_M } from './validate';
import { terminiMeet, type TerminusMeeting } from './selectionRelations';

/** A leg list traversed the other way round: the order reverses, and each
 *  leg's direction of travel flips. The extent is left alone — fromT/toT
 *  measure along the WAY's own path, not along travel, so which end of the
 *  stretch you enter first is exactly what `forward` says. */
function reverseLegs(legs: PatternLeg[]): PatternLeg[] {
  return [...legs].reverse().map((leg) => ({ ...leg, forward: !leg.forward }));
}

/** Legs oriented so that `end` is the last thing travelled. */
function legsEndingAt(pattern: Pattern, end: 'start' | 'end'): PatternLeg[] {
  return end === 'end' ? pattern.legs : reverseLegs(pattern.legs);
}

/** Legs oriented so that `end` is the first thing travelled. */
function legsStartingAt(pattern: Pattern, end: 'start' | 'end'): PatternLeg[] {
  return end === 'start' ? pattern.legs : reverseLegs(pattern.legs);
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
  return leg ? system.ways.find((w) => w.id === leg.wayId) : undefined;
}

/**
 * The legs that carry a vehicle from one line's terminus to the other's,
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

  const fromWay = wayAtEnd(system, from.pattern.legs, from.end);
  const toWay = wayAtEnd(system, to.pattern.legs, to.end);
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
 * Join `otherId` onto `keepId` as one continuous line.
 *
 * The joined line keeps `keepId`'s name, colour, and schedule, because a
 * through-route is one of the two lines carrying on rather than a new thing
 * with no history. Any pattern of the source that was not the one joined
 * carries over as a branch, named after the source service if it had no name
 * of its own — the same rule mergeServiceInto uses, so a branch list still
 * reads as "which line was this".
 *
 * Returns null and changes nothing when the modes differ, when the termini do
 * not meet, or when no infrastructure connects them.
 */
export function throughRouteServices(
  system: TransitSystem,
  keepId: string,
  otherId: string,
): TransitSystem | null {
  const keep = system.services.find((s) => s.id === keepId);
  const other = system.services.find((s) => s.id === otherId);
  if (!keep || !other || keep.id === other.id || keep.modeId !== other.modeId) return null;

  const meeting: TerminusMeeting | null = terminiMeet(system, keepId, otherId);
  if (!meeting) return null;
  const keepPattern = keep.patterns.find((p) => p.id === meeting.aPatternId);
  const otherPattern = other.patterns.find((p) => p.id === meeting.bPatternId);
  if (!keepPattern || !otherPattern) return null;

  const connector = connectorLegs(
    system,
    keep,
    { pattern: keepPattern, end: meeting.aEnd },
    { pattern: otherPattern, end: meeting.bEnd },
  );
  if (!connector) return null;

  const joined: Pattern = {
    ...keepPattern,
    legs: [
      ...legsEndingAt(keepPattern, meeting.aEnd),
      ...connector,
      ...legsStartingAt(otherPattern, meeting.bEnd),
    ],
  };

  const carried = other.patterns
    .filter((p) => p.id !== otherPattern.id)
    .map((p) => ({ ...p, name: p.name ?? other.name }));

  return {
    ...system,
    services: system.services
      .filter((s) => s.id !== otherId)
      .map((s) =>
        s.id === keepId
          ? {
              ...s,
              patterns: [...s.patterns.map((p) => (p.id === joined.id ? joined : p)), ...carried],
            }
          : s,
      ),
    updatedAt: Date.now(),
  };
}
