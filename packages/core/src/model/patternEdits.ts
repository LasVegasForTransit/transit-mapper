// How a pattern's legs change — both when the infrastructure underneath them
// moves, and when someone edits the line itself.
//
// A leg names a stretch of a way as a fraction of that way's length, so any
// edit that changes what a way IS — splitting it, merging it with its
// neighbour — changes what those fractions mean. Before extents existed the
// store could get away with rewriting a bare list of way ids; now every such
// edit has to rescale the stretch too, or a service that covered the middle
// of a block silently jumps to covering the start of it.
//
// The same arithmetic is what makes a line editable in pieces: trimming a line
// back, cutting one in two, and taking a stretch of road out from under one
// are all the same operation on a leg's range.
//
// Pure and geometry-free: the store supplies the one measurement each
// operation needs (where the split fell, where an old position landed on the
// merged way, where the user clicked) and this decides what the legs become.
// That keeps the arithmetic testable without building a system to test it
// against.

import { legRange, legRunsWithPoints } from './geo/servicePaths';
import type { LegDirection, PatternLeg, PatternSection } from './system';

/**
 * Apply a leg rewrite to every section of a pattern, each section's list on
 * its own.
 *
 * This is how the arithmetic below survived sections without being rewritten.
 * Splitting a way, merging two, or removing a stretch are all facts about the
 * INFRASTRUCTURE: they apply wherever a leg names the affected way, and a
 * couplet's two halves are affected independently and identically. So the
 * per-leg arithmetic never needs to know which direction it is working on.
 *
 * The edits that DO care which direction they cut — trimming a line back,
 * cutting one in two — are not this shape, because the point to cut at has to
 * be found separately on each direction's own ground. Those take a section
 * index, not a callback.
 */
export function mapSectionLegs(
  sections: PatternSection[],
  fn: (legs: PatternLeg[]) => PatternLeg[],
): PatternSection[] {
  return sections.map((section) => {
    if (section.kind === 'split') {
      const outbound = fn(section.outbound);
      const inbound = fn(section.inbound);
      return outbound === section.outbound && inbound === section.inbound
        ? section
        : { ...section, outbound, inbound };
    }
    const legs = fn(section.legs);
    return legs === section.legs ? section : { ...section, legs };
  });
}

/**
 * Collapse a `split` back to `shared` once its two sides have landed on the
 * same ground.
 *
 * Infrastructure edits can do this without anyone deciding to: merge a
 * couplet's two one-way streets into one two-way street and the line still
 * runs out and back, but now over the same way. Left as a split it is a lie
 * with visible consequences — the schematic draws one-way chevrons in BOTH
 * directions along a street that carries both, and the inspector goes on
 * offering to un-split a line that is no longer split.
 *
 * "Same ground" is the same set of ways covering overlapping stretches. The
 * two sides run it in opposite directions, which is exactly what a shared
 * stretch means, so the outbound legs survive as the shared ones.
 */
export function normalizeSections(sections: PatternSection[]): PatternSection[] {
  return sections.map((section) => {
    if (section.kind !== 'split') return section;
    return sidesCoverSameGround(section.outbound, section.inbound)
      ? { kind: 'shared', legs: section.outbound }
      : section;
  });
}

function sidesCoverSameGround(a: PatternLeg[], b: PatternLeg[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const rangesByWay = (legs: PatternLeg[]) => {
    const out = new Map<string, [number, number][]>();
    for (const leg of legs) {
      const list = out.get(leg.wayId) ?? [];
      list.push(legRange(leg));
      out.set(leg.wayId, list);
    }
    return out;
  };
  const ra = rangesByWay(a);
  const rb = rangesByWay(b);
  if (ra.size !== rb.size) return false;
  for (const [wayId, aRanges] of ra) {
    const bRanges = rb.get(wayId);
    if (!bRanges) return false;
    // Every stretch one side rides has to be ridden by the other. Overlap
    // rather than equality: the two directions of one street are measured
    // from opposite ends and come back off by float noise.
    const covered = (from: [number, number][], by: [number, number][]) =>
      from.every(([lo, hi]) =>
        by.some(([lo2, hi2]) => Math.min(hi, hi2) - Math.max(lo, lo2) > -TOUCH_T),
      );
    if (!covered(aRanges, bRanges) || !covered(bRanges, aRanges)) return false;
  }
  return true;
}

/** Sections with every empty leg list dropped, and the whole thing dropped to
 *  [] when nothing survives. An edit that removes the last leg of a section
 *  leaves a section that describes no ground, which every reader would then
 *  have to special-case. */
export function pruneSections(sections: PatternSection[]): PatternSection[] {
  return sections.filter((section) =>
    section.kind === 'split'
      ? section.outbound.length > 0 || section.inbound.length > 0
      : section.legs.length > 0,
  );
}

/** Two extents this close (as a fraction of the way) are treated as touching.
 *  Legs that were adjacent by construction come back from a coordinate
 *  round-trip off by float noise, and leaving a hairline gap between them
 *  would make a continuous pattern read as a broken one. 0.1% of a 5 km way is
 *  5 m — far below anything a person drew on purpose. */
const TOUCH_T = 1e-3;

/** A leg covering `[lo, hi]` of its way, normalized back to `'whole'` when it
 *  covers everything — so a leg widened to full length is indistinguishable
 *  from one that was never trimmed, rather than carrying a pair of numbers
 *  that mean "no trim". */
function withRange(leg: PatternLeg, lo: number, hi: number): PatternLeg {
  const clampedLo = Math.max(0, Math.min(1, Math.min(lo, hi)));
  const clampedHi = Math.max(0, Math.min(1, Math.max(lo, hi)));
  const whole = clampedLo <= 0 && clampedHi >= 1;
  return {
    ...leg,
    extent: whole ? { kind: 'whole' } : { kind: 'stretch', fromT: clampedLo, toT: clampedHi },
  };
}

/**
 * Rewrite legs for a way that has just been split in two at normalized
 * position `tSplit` along its resolved path — the first half keeping `wayId`,
 * the second becoming `newWayId`.
 *
 * A leg wholly inside one half moves to that half with its extent rescaled
 * against the half's own length. A leg spanning the split becomes two, ordered
 * the way the pattern travels them: a pattern running backward along the way
 * reaches the second half first.
 *
 * A leg covering the whole way produces two whole-covering legs, which is
 * exactly what the id-list rewrite this replaced did.
 */
export function splitLegs(
  legs: PatternLeg[],
  wayId: string,
  newWayId: string,
  tSplit: number,
): PatternLeg[] {
  // A split at either end leaves one piece with no length; the caller already
  // refuses those, and rescaling by zero here would produce infinities.
  if (!(tSplit > 0 && tSplit < 1)) return legs;
  const ontoFirst = (t: number): number => t / tSplit;
  const ontoSecond = (t: number): number => (t - tSplit) / (1 - tSplit);
  return legs.flatMap((leg): PatternLeg[] => {
    if (leg.wayId !== wayId) return [leg];
    const [lo, hi] = legRange(leg);
    if (hi <= tSplit) return [withRange(leg, ontoFirst(lo), ontoFirst(hi))];
    if (lo >= tSplit)
      return [withRange({ ...leg, wayId: newWayId }, ontoSecond(lo), ontoSecond(hi))];
    const first = withRange(leg, ontoFirst(lo), 1);
    const second = withRange({ ...leg, wayId: newWayId }, 0, ontoSecond(hi));
    return legRunsWithPoints(leg) ? [first, second] : [second, first];
  });
}

/** What the store must measure for mergeLegs: where an old position on either
 *  of the two ways now sits on the merged one, and whether that way's point
 *  order was reversed to make the join. */
export interface MergeRemap {
  /** The merged way's normalized position for position `t` on `wayId`. */
  positionOf: (wayId: string, t: number) => number;
  /** Whether `wayId`'s points were reversed into the merged way — a leg on a
   *  reversed way travels the merged way the other way round. */
  reversed: (wayId: string) => boolean;
}

function legsUseSameLane(left: PatternLeg, right: PatternLeg): boolean {
  if (left.lane.kind !== right.lane.kind) return false;
  return (
    left.lane.kind === 'auto' ||
    (right.lane.kind === 'pinned' && left.lane.laneId === right.lane.laneId)
  );
}

/**
 * Rewrite legs for two ways merged end-to-end into one, `otherId` folded into
 * `keepId`.
 *
 * Both ways' extents are remeasured against the merged way, and consecutive
 * legs that now name it and meet are collapsed into one — the adjacency
 * collapse the id-list rewrite did, extended to keep the union of the two
 * stretches rather than assuming both covered everything.
 */
export function mergeLegs(
  legs: PatternLeg[],
  keepId: string,
  otherId: string,
  remap: MergeRemap,
): PatternLeg[] {
  const remapped = legs.map((leg): PatternLeg => {
    if (leg.wayId !== keepId && leg.wayId !== otherId) return leg;
    const [lo, hi] = legRange(leg);
    const a = remap.positionOf(leg.wayId, lo);
    const b = remap.positionOf(leg.wayId, hi);
    // Reversing a way's points changes which way round the leg runs it.
    const flip = remap.reversed(leg.wayId);
    const direction: LegDirection =
      flip === legRunsWithPoints(leg) ? 'againstPoints' : 'withPoints';
    return withRange({ ...leg, wayId: keepId, direction }, a, b);
  });

  const out: PatternLeg[] = [];
  for (const leg of remapped) {
    const last = out.at(-1);
    if (
      last?.wayId === leg.wayId &&
      last.direction === leg.direction &&
      legsUseSameLane(last, leg)
    ) {
      const [lastLo, lastHi] = legRange(last);
      const [lo, hi] = legRange(leg);
      if (Math.min(lastHi, hi) >= Math.max(lastLo, lo) - TOUCH_T) {
        out[out.length - 1] = withRange(last, Math.min(lastLo, lo), Math.max(lastHi, hi));
        continue;
      }
    }
    out.push(leg);
  }
  return out;
}

/** A leg covering less ground than this is not worth keeping — the user
 *  dragged a terminus onto a junction, or a deleted stretch consumed almost
 *  all of it. Dropping it beats storing a leg nothing can draw. */
const MIN_LEG_T = 1e-6;

function legIsDegenerate(leg: PatternLeg): boolean {
  const [lo, hi] = legRange(leg);
  return hi - lo < MIN_LEG_T;
}

/**
 * Cut a pattern back so it begins — or ends — at position `t` on the leg at
 * `legIndex`, dropping everything beyond that point in RIDE order.
 *
 * `t` is measured along the way, so which end of the leg's range survives
 * depends on which direction the pattern travels it. Cutting the start of a
 * pattern that runs a way backward keeps the low end of that way, not the
 * high one.
 *
 * This is what "drag a line's terminus back past two stops" and "terminate
 * here" both come down to.
 */
export function truncateLegs(
  legs: PatternLeg[],
  legIndex: number,
  t: number,
  side: 'start' | 'end',
): PatternLeg[] {
  const leg = legs[legIndex];
  if (!leg) return legs;
  const [lo, hi] = legRange(leg);
  const at = Math.max(lo, Math.min(hi, t));
  const keepsLowEnd = side === 'end' ? legRunsWithPoints(leg) : !legRunsWithPoints(leg);
  const trimmed = keepsLowEnd ? withRange(leg, lo, at) : withRange(leg, at, hi);
  const kept = side === 'start' ? legs.slice(legIndex + 1) : legs.slice(0, legIndex);
  const withTrimmed = side === 'start' ? [trimmed, ...kept] : [...kept, trimmed];
  return withTrimmed.filter((l) => !legIsDegenerate(l));
}

/**
 * Cut a pattern in two at position `t` on the leg at `legIndex`: everything up
 * to that point, and everything from it on. Either half comes back empty when
 * the cut lands on a terminus, which the caller should treat as "nothing to
 * split" rather than as a service with no route.
 */
export function splitLegsAt(
  legs: PatternLeg[],
  legIndex: number,
  t: number,
): [PatternLeg[], PatternLeg[]] {
  return [truncateLegs(legs, legIndex, t, 'end'), truncateLegs(legs, legIndex, t, 'start')];
}

/**
 * Remove the stretch `[fromT, toT]` of `wayId` from a pattern's legs — what a
 * line does when the road under part of it is taken away.
 *
 * A leg the stretch cuts through yields the pieces on either side, so the
 * result can describe a route with a hole in it. That is deliberate: the
 * alternative is silently discarding whichever half is shorter, and half a
 * line is not something to throw away without saying so. The caller splits the
 * result into separate patterns — see how the store uses it — so a system is
 * never left holding a pattern validateSystem would flag.
 */
export function removeStretchFromLegs(
  legs: PatternLeg[],
  wayId: string,
  fromT: number,
  toT: number,
): PatternLeg[] {
  const cutLo = Math.max(0, Math.min(1, Math.min(fromT, toT)));
  const cutHi = Math.max(0, Math.min(1, Math.max(fromT, toT)));
  return legs
    .flatMap((leg): PatternLeg[] => {
      if (leg.wayId !== wayId) return [leg];
      const [lo, hi] = legRange(leg);
      if (cutHi <= lo || cutLo >= hi) return [leg]; // the cut misses this leg
      const before = lo < cutLo ? withRange(leg, lo, cutLo) : null;
      const after = cutHi < hi ? withRange(leg, cutHi, hi) : null;
      const pieces = [before, after].filter((l): l is PatternLeg => l !== null);
      // Ride order: travelling the way backward reaches the high piece first.
      return legRunsWithPoints(leg) ? pieces : pieces.reverse();
    })
    .filter((l) => !legIsDegenerate(l));
}

/**
 * Break a leg list into the runs that are actually joined, given a test for
 * whether two consecutive legs meet on the ground.
 *
 * A pattern must describe one continuous path, so an edit that leaves a hole
 * has to become two patterns rather than one broken one. The store supplies
 * the continuity test because answering it needs geometry.
 */
export function splitLegsIntoRuns(
  legs: PatternLeg[],
  joined: (a: PatternLeg, b: PatternLeg) => boolean,
): PatternLeg[][] {
  const runs: PatternLeg[][] = [];
  for (const leg of legs) {
    const current = runs[runs.length - 1];
    if (current && joined(current[current.length - 1], leg)) current.push(leg);
    else runs.push([leg]);
  }
  return runs;
}
