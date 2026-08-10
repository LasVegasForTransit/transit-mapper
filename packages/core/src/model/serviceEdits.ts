import { legRange, legRunsWithPoints, patternRunLegs, patternRunPath } from './geo/servicePaths';
import { haversineMeters } from './geo/spherical';
import { nearestOnPath, pathLengthMeters, pointAtT, slicePathByT } from './geo/measurement';
import { resolveWayPath } from './geo/wayPath';
import { pruneSections, splitLegsAt, truncateLegs } from './patternEdits';
import type { LngLat, Pattern, PatternLeg, PatternSection, RunDirection, Way } from './system';

/**
 * One exact point on one trip through a pattern.
 *
 * A way can occur more than once in one run, so its id and way-relative
 * position cannot identify an edit target. `legIndex` is the occurrence in
 * this run and `distanceMeters` gives callers a stable ordering along it.
 */
export interface PatternPosition {
  patternId: string;
  run: RunDirection;
  legIndex: number;
  wayId: string;
  t: number;
  distanceMeters: number;
}

/** Resolve one requested run-leg occurrence into an edit position. */
export function patternPositionAt(
  ways: Way[],
  pattern: Pattern,
  run: RunDirection,
  legIndex: number,
  t: number,
): PatternPosition | null {
  const runLegs = patternRunLegs(pattern, run);
  const target = runLegs[legIndex];
  if (!target) return null;
  const [lo, hi] = legRange(target.leg);
  if (t < lo || t > hi) return null;

  let distanceMeters = 0;
  for (let i = 0; i <= legIndex; i += 1) {
    const current = runLegs[i];
    const way = ways.find((candidate) => candidate.id === current.leg.wayId);
    if (!way) return null;
    const path = resolveWayPath(way);
    if (path.length < 2) return null;
    const [currentLo, currentHi] = legRange(current.leg);
    const from = current.forward ? currentLo : currentHi;
    const to = i === legIndex ? t : current.forward ? currentHi : currentLo;
    distanceMeters += pathLengthMeters(slicePathByT(path, from, to));
  }

  return { patternId: pattern.id, run, legIndex, wayId: target.leg.wayId, t, distanceMeters };
}

/** Add materialized route legs beyond one end without touching infrastructure. */
export function extendPatternTerminus(
  pattern: Pattern,
  side: 'start' | 'end',
  legs: PatternLeg[],
): Pattern | null {
  if (legs.length === 0) return null;
  // A route draft grows outward FROM the terminus it grabbed. That is already
  // outbound order at the end, but prepending it at the start needs the route
  // read back from its newly drawn endpoint toward the old terminus.
  const extensionLegs: PatternLeg[] =
    side === 'end'
      ? legs
      : [...legs].reverse().map((leg) => ({
          ...leg,
          direction: leg.direction === 'withPoints' ? 'againstPoints' : 'withPoints',
        }));
  const extension = { kind: 'shared' as const, legs: extensionLegs };
  return {
    ...pattern,
    sections:
      side === 'start' ? [extension, ...pattern.sections] : [...pattern.sections, extension],
  };
}

/** A route endpoint in its actual ride direction. */
function legEndpoint(ways: Way[], leg: PatternLeg, endpoint: 'start' | 'end'): LngLat | null {
  const way = ways.find((candidate) => candidate.id === leg.wayId);
  if (!way) return null;
  const path = resolveWayPath(way);
  if (path.length < 2) return null;
  const [lo, hi] = legRange(leg);
  const travelsForward = legRunsWithPoints(leg);
  const atStart = endpoint === 'start';
  const t = atStart === travelsForward ? lo : hi;
  return pointAtT(path, t);
}

function samePlace(a: LngLat | null, b: LngLat | null): boolean {
  return !!a && !!b && haversineMeters(a, b) < 0.01;
}

/**
 * Join an outbound terminus back to an earlier exact outbound occurrence.
 *
 * The shared prefix remains two-way. The original tail is outbound-only and
 * the materialized closing route becomes its inbound counterpart. This is the
 * route-model form of a terminal loop: it never changes the corridor itself.
 */
export function closePatternTerminus(
  ways: Way[],
  pattern: Pattern,
  side: 'start' | 'end',
  target: PatternPosition,
  closingLegs: PatternLeg[],
): Pattern | null {
  if (target.patternId !== pattern.id || target.run !== 'outbound') return null;
  if (closingLegs.length === 0 || pattern.sections.some((section) => section.kind !== 'shared'))
    return null;
  const exact = patternPositionAt(ways, pattern, target.run, target.legIndex, target.t);
  if (exact?.wayId !== target.wayId) return null;

  const outbound = patternRunLegs(pattern, 'outbound');
  const terminus = side === 'start' ? outbound[0] : outbound[outbound.length - 1];
  const firstClosing = closingLegs[0];
  const lastClosing = closingLegs[closingLegs.length - 1];
  const targetWay = ways.find((way) => way.id === target.wayId);
  const targetPath = targetWay ? resolveWayPath(targetWay) : [];
  const targetAt = targetPath.length >= 2 ? pointAtT(targetPath, target.t) : null;
  if (
    !terminus ||
    !samePlace(legEndpoint(ways, terminus.leg, side), legEndpoint(ways, firstClosing, 'start')) ||
    !samePlace(targetAt, legEndpoint(ways, lastClosing, 'end'))
  )
    return null;

  for (let i = 1; i < closingLegs.length; i += 1)
    if (
      !samePlace(
        legEndpoint(ways, closingLegs[i - 1], 'end'),
        legEndpoint(ways, closingLegs[i], 'start'),
      )
    )
      return null;

  const sharedLegs = pattern.sections.flatMap((section) =>
    section.kind === 'shared' ? section.legs : [],
  );
  const [prefix, tail] = splitLegsAt(sharedLegs, target.legIndex, target.t);
  if (prefix.length === 0 || tail.length === 0) return null;
  if (side === 'start') {
    const inbound = [...prefix].reverse().map((leg) => ({
      ...leg,
      direction:
        leg.direction === 'withPoints' ? ('againstPoints' as const) : ('withPoints' as const),
    }));
    return {
      ...pattern,
      sections: [
        { kind: 'split', outbound: closingLegs, inbound },
        { kind: 'shared', legs: tail },
      ],
    };
  }
  return {
    ...pattern,
    sections: [
      { kind: 'shared', legs: prefix },
      { kind: 'split', outbound: tail, inbound: closingLegs },
    ],
  };
}

interface SectionOccurrence {
  sectionIndex: number;
  legIndex: number;
  section: PatternSection;
}

function sectionOccurrence(pattern: Pattern, position: PatternPosition): SectionOccurrence | null {
  const runLeg = patternRunLegs(pattern, position.run)[position.legIndex];
  if (!runLeg) return null;
  for (const [sectionIndex, section] of pattern.sections.entries()) {
    const legs =
      section.kind === 'split'
        ? position.run === 'outbound'
          ? section.outbound
          : section.inbound
        : section.legs;
    const legIndex = legs.indexOf(runLeg.leg);
    if (legIndex >= 0) return { sectionIndex, legIndex, section };
  }
  return null;
}

function coordinateAtPosition(ways: Way[], position: PatternPosition): LngLat | null {
  const way = ways.find((candidate) => candidate.id === position.wayId);
  if (!way) return null;
  const path = resolveWayPath(way);
  return path.length >= 2 ? pointAtT(path, position.t) : null;
}

function nearestLegIndex(
  ways: Way[],
  legs: PatternLeg[],
  coord: LngLat,
): { legIndex: number; t: number } | null {
  let best: { legIndex: number; t: number; distMeters: number } | null = null;
  for (const [legIndex, leg] of legs.entries()) {
    const way = ways.find((candidate) => candidate.id === leg.wayId);
    if (!way) continue;
    const near = nearestOnPath(resolveWayPath(way), coord);
    if (!near || (best && best.distMeters <= near.distMeters)) continue;
    best = { legIndex, t: near.t, distMeters: near.distMeters };
  }
  return best ? { legIndex: best.legIndex, t: best.t } : null;
}

/** Cut a pattern from an exact run-leg occurrence while keeping its section structure. */
export function trimPatternAtPosition(
  ways: Way[],
  pattern: Pattern,
  position: PatternPosition,
  side: 'start' | 'end',
): Pattern | null {
  if (position.patternId !== pattern.id) return null;
  const exact = patternPositionAt(ways, pattern, position.run, position.legIndex, position.t);
  if (!exact || exact.wayId !== position.wayId) return null;
  const occurrence = sectionOccurrence(pattern, position);
  if (!occurrence) return null;
  const cutSection = (() => {
    if (occurrence.section.kind !== 'split')
      return {
        ...occurrence.section,
        legs: truncateLegs(occurrence.section.legs, occurrence.legIndex, position.t, side),
      };

    const coord = coordinateAtPosition(ways, position);
    if (!coord) return null;
    if (position.run === 'outbound') {
      const inboundAt = nearestLegIndex(ways, occurrence.section.inbound, coord);
      if (!inboundAt) return null;
      return {
        kind: 'split' as const,
        outbound: truncateLegs(occurrence.section.outbound, occurrence.legIndex, position.t, side),
        inbound: truncateLegs(
          occurrence.section.inbound,
          inboundAt.legIndex,
          inboundAt.t,
          side === 'end' ? 'start' : 'end',
        ),
      };
    }
    const outboundAt = nearestLegIndex(ways, occurrence.section.outbound, coord);
    if (!outboundAt) return null;
    return {
      kind: 'split' as const,
      outbound: truncateLegs(occurrence.section.outbound, outboundAt.legIndex, outboundAt.t, side),
      inbound: truncateLegs(
        occurrence.section.inbound,
        occurrence.legIndex,
        position.t,
        side === 'end' ? 'start' : 'end',
      ),
    };
  })();
  if (!cutSection) return null;
  const kept =
    side === 'start'
      ? pattern.sections.slice(occurrence.sectionIndex + 1)
      : pattern.sections.slice(0, occurrence.sectionIndex);
  const sections = pruneSections(side === 'start' ? [cutSection, ...kept] : [...kept, cutSection]);
  return sections.length > 0 ? { ...pattern, sections } : null;
}

function operatingPathMeters(ways: Way[], pattern: Pattern): number {
  return (
    pathLengthMeters(patternRunPath(ways, pattern, 'outbound')) +
    pathLengthMeters(patternRunPath(ways, pattern, 'inbound'))
  );
}

export interface PatternEnd {
  pattern: Pattern;
  /** The terminus discarded to make this end; mirrors the store's trim side. */
  side: 'start' | 'end';
}

/**
 * End a shared pattern at an exact displayed occurrence, keeping the longer
 * usable half. This makes a repeated corridor unambiguous and avoids the
 * surprising result of dropping the longer side merely because it happened
 * to be drawn first.
 */
export function endPatternAtPosition(
  ways: Way[],
  pattern: Pattern,
  position: PatternPosition,
): PatternEnd | null {
  const before = trimPatternAtPosition(ways, pattern, position, 'end');
  const after = trimPatternAtPosition(ways, pattern, position, 'start');
  if (!before || !after) return null;
  return operatingPathMeters(ways, before) >= operatingPathMeters(ways, after)
    ? { pattern: before, side: 'end' }
    : { pattern: after, side: 'start' };
}

export interface PatternDivision {
  /** The longer half, which retains the source service's identity. */
  remaining: Pattern;
  /** The shorter half, ready for the store to give a new identity. */
  divided: Pattern;
}

/** Divide one Service path into two independently usable paths. */
export function dividePatternAtPosition(
  ways: Way[],
  pattern: Pattern,
  position: PatternPosition,
): PatternDivision | null {
  const before = trimPatternAtPosition(ways, pattern, position, 'end');
  const after = trimPatternAtPosition(ways, pattern, position, 'start');
  if (!before || !after) return null;
  return operatingPathMeters(ways, before) >= operatingPathMeters(ways, after)
    ? { remaining: before, divided: after }
    : { remaining: after, divided: before };
}
