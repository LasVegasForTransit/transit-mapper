// How many vehicles a pattern runs, and where each one is at a given moment.
//
// This is where "every 10 minutes" stops being approximately true. The
// animation used to divide the round trip by the headway, floor it, and then
// space that many vehicles evenly around the loop — so a 47-minute round trip
// at a 10-minute headway ran four vehicles 11.75 minutes apart, and the number
// typed into the inspector was close to, but not, what the map showed.
//
// Here the CYCLE is built from the headway instead of the other way round,
// which is also how a real agency sizes a line: work out how long a round trip
// takes, round it up to a whole number of headways, and the leftover is
// recovery time the vehicle spends sitting at the end of the line. Fleet size
// falls out of that, and because the cycle is an exact multiple of the
// headway, consecutive vehicles pass every stop exactly one headway apart —
// including across the wrap from the last vehicle back to the first, which is
// the seam even-spacing gets wrong.
//
// Pure, like the rest of packages/core/src/sim: time comes in as an argument.

import { metersAtElapsed, VEHICLE_SPEED_MPS, type Timetable } from './timetable';

/** Every line gets at least this much recovery time per round trip, however
 *  short it is — a vehicle that reached the end of the line and instantly
 *  turned around would be running a schedule no operator could keep. */
const MIN_LAYOVER_MS = 2 * 60_000;

/** …and a long line gets proportionally more, since recovery time in practice
 *  scales with how much there is to recover from. Not a stored, editable
 *  figure yet: it's a plausible default, and making it per-service is a schema
 *  change worth making only once someone wants to tune it. */
const LAYOVER_FRACTION = 0.05;

export interface ServicePlan {
  /** How many vehicles this pattern runs at once. */
  fleet: number;
  /** The full out-and-back cycle one vehicle repeats, an exact whole number
   *  of headways. */
  cycleMs: number;
  /** Recovery time at EACH terminal — half the slack between the round trip
   *  and the cycle. */
  layoverMs: number;
  /** The headway this plan actually delivers. Equal to the requested one; it
   *  is returned so callers phasing vehicles don't have to divide. */
  headwayMs: number;
}

/** Where a vehicle is in its cycle. `layover` is a vehicle holding at a
 *  terminal; dwelling at an intermediate stop is inside the travel legs, since
 *  the timetable already holds position through a dwell. */
export type RunPhase = 'outbound' | 'inbound' | 'layover';

export interface RunState {
  /** Distance along the pattern path from its start, in meters. Always
   *  measured along the OUTBOUND path, whichever leg the vehicle is on, so one
   *  number describes a position on the line regardless of heading. */
  distMeters: number;
  phase: RunPhase;
  /** Which leg the vehicle is running. The return leg rides the opposite lane
   *  — a different polyline on real infrastructure — so a caller drawing the
   *  vehicle needs this to pick the right one. A vehicle laying over at a
   *  terminal is on the leg it just finished. */
  leg: 'outbound' | 'inbound';
}

function minimumLayoverMs(roundTripMs: number): number {
  return Math.max(MIN_LAYOVER_MS, roundTripMs * LAYOVER_FRACTION);
}

/**
 * Size a pattern's fleet for a headway.
 *
 * With no headway (a service that has never had one set — which is every
 * GTFS-imported route today) this plans a single vehicle running the line on
 * its own, which is the behavior those services have always had.
 */
export function planService(roundTripMs: number, headwayMs?: number): ServicePlan {
  const minLayover = minimumLayoverMs(roundTripMs);
  // A headway longer than the whole round trip is legitimate and common (a
  // 60-minute rural route on a 25-minute loop): one vehicle, waiting a long
  // time at the terminal between runs. The ceil below handles it — fleet 1,
  // cycle exactly one headway.
  const effectiveHeadway =
    headwayMs !== undefined && headwayMs > 0 ? headwayMs : roundTripMs + minLayover;
  const fleet = Math.max(1, Math.ceil((roundTripMs + minLayover) / effectiveHeadway));
  const cycleMs = fleet * effectiveHeadway;
  return { fleet, cycleMs, layoverMs: (cycleMs - roundTripMs) / 2, headwayMs: effectiveHeadway };
}

/**
 * Where run `index` is at simulated instant `simMs`.
 *
 * Run i departs one headway after run i-1, so its position is the same
 * function evaluated one headway earlier — no per-vehicle state, and the
 * modulo makes the cycle wrap exact rather than approximately even.
 *
 * `speedMps` must be the speed the timetable was BUILT with, or the two
 * disagree and a vehicle arrives early (and sits clamped at the end) or never
 * arrives at all.
 */
export function runStateAt(
  simMs: number,
  timetable: Timetable,
  totalMeters: number,
  plan: ServicePlan,
  index: number,
  speedMps: number = VEHICLE_SPEED_MPS,
): RunState {
  const { cycleMs, layoverMs, headwayMs } = plan;
  const intoCycle = (((simMs - index * headwayMs) % cycleMs) + cycleMs) % cycleMs;
  const oneWayMs = timetable.oneWayMs;

  if (intoCycle < oneWayMs) {
    return {
      distMeters: metersAtElapsed(totalMeters, timetable, intoCycle, speedMps),
      phase: 'outbound',
      leg: 'outbound',
    };
  }
  const afterOutbound = intoCycle - oneWayMs;
  if (afterOutbound < layoverMs) {
    return { distMeters: totalMeters, phase: 'layover', leg: 'outbound' };
  }
  const intoReturn = afterOutbound - layoverMs;
  if (intoReturn < oneWayMs) {
    // The return leg is the same timetable mirrored — the dwell points are the
    // same physical stations whichever way the vehicle is facing.
    return {
      distMeters: totalMeters - metersAtElapsed(totalMeters, timetable, intoReturn, speedMps),
      phase: 'inbound',
      leg: 'inbound',
    };
  }
  return { distMeters: 0, phase: 'layover', leg: 'inbound' };
}
