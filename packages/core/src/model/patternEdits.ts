// How a pattern's legs survive edits to the infrastructure underneath them.
//
// A leg names a stretch of a way as a fraction of that way's length, so any
// edit that changes what a way IS — splitting it, merging it with its
// neighbour — changes what those fractions mean. Before extents existed the
// store could get away with rewriting a bare list of way ids; now every such
// edit has to rescale the stretch too, or a service that covered the middle
// of a block silently jumps to covering the start of it.
//
// Pure and geometry-free: the store supplies the one measurement each
// operation needs (where the split fell, where an old position landed on the
// merged way) and this decides what the legs become. That keeps the arithmetic
// testable without building a system to test it against.

import { legRange } from './geo/servicePaths';
import type { PatternLeg } from './system';

/** Two extents this close (as a fraction of the way) are treated as touching.
 *  Legs that were adjacent by construction come back from a coordinate
 *  round-trip off by float noise, and leaving a hairline gap between them
 *  would make a continuous pattern read as a broken one. 0.1% of a 5 km way is
 *  5 m — far below anything a person drew on purpose. */
const TOUCH_T = 1e-3;

/** A leg covering `[lo, hi]` of its way, with the extent dropped entirely when
 *  it covers the whole thing — so the common case stays free of numbers that
 *  mean "no trim" and round-trips through serialization unchanged. */
function withRange(leg: PatternLeg, lo: number, hi: number): PatternLeg {
  const clampedLo = Math.max(0, Math.min(1, Math.min(lo, hi)));
  const clampedHi = Math.max(0, Math.min(1, Math.max(lo, hi)));
  const whole = clampedLo <= 0 && clampedHi >= 1;
  const { fromT: _fromT, toT: _toT, ...rest } = leg;
  return whole ? rest : { ...rest, fromT: clampedLo, toT: clampedHi };
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
    return leg.forward ? [first, second] : [second, first];
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
    const forward = remap.reversed(leg.wayId) ? !leg.forward : leg.forward;
    return withRange({ ...leg, wayId: keepId, forward }, a, b);
  });

  const out: PatternLeg[] = [];
  for (const leg of remapped) {
    const last = out[out.length - 1];
    if (last && last.wayId === leg.wayId && last.forward === leg.forward) {
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
