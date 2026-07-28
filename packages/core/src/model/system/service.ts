import type { ScheduleDayScope } from './valueTypes';

/**
 * One way in a pattern's path, and how much of it the pattern uses.
 *
 * A leg exists so a service can cover PART of a way. Before it, a pattern held
 * a bare list of way ids, so a service that started or stopped mid-block had
 * to be made to fit by splitting the way underneath it — which mutated that
 * way for every other service riding it, reanchored every station on it, and
 * left a permanent fragment behind. A corridor carrying many lines
 * accumulated one fragment per line that terminated on it. Extents are how a
 * service stops doing that.
 */
/** Which way round a leg runs its way, relative to that way's own stored
 *  point order. Stored rather than derived: the geometry cannot always
 *  determine it (a single-way pattern, a neighbour sharing both endpoints),
 *  and a wrong guess used to mean "wrong lane" but now means "the wrong half
 *  of the way". geo/servicePaths.ts's deriveLegDirections supplies it wherever
 *  a caller has only geometry. */
export type LegDirection = 'withPoints' | 'againstPoints';

/**
 * How much of its way a leg uses.
 *
 * A union rather than a pair of optional numbers, because "covers the whole
 * way" is a real state and not an absence: patternEdits' withRange drops the
 * numbers entirely when a leg grows to cover everything, precisely so the
 * common case round-trips through serialization without numbers that mean "no
 * trim". Two independent optionals also admit a `fromT` with no `toT`, which
 * has never meant anything.
 *
 * `fromT`/`toT` are normalized arc-length along the way's OWN resolved path —
 * the same 0-at-the-first-point convention as StationAnchor.t, not travel
 * order — so `direction` stays the only thing that says which way round.
 */
export type LegExtent = { kind: 'whole' } | { kind: 'stretch'; fromT: number; toT: number };

/**
 * Which lane of its way a leg rides.
 *
 * `'auto'` resolves at render time to the rightmost travel lane in the
 * direction of travel, or a dedicated bus lane / the direction's track — see
 * profile.ts's `defaultLaneFor`. It is distinct from a pin that happens to
 * name today's default: re-profiling the street moves an `'auto'` leg with it
 * and leaves a pinned one where the user put it.
 */
export type LegLane = { kind: 'auto' } | { kind: 'pinned'; laneId: string };

export interface PatternLeg {
  wayId: string;
  direction: LegDirection;
  extent: LegExtent;
  lane: LegLane;
}

/** One path a service runs — more than one on the same service models a
 *  branch/variant sharing that service's identity (name/color/mode), e.g. a
 *  trunk splitting into an airport branch and a downtown branch. */
export interface Pattern {
  id: string;
  /** Ordered ways this pattern runs over, with the stretch of each it uses
   *  (its path; may span way types). Consecutive legs must meet: validate.ts
   *  checks that, since a leg list can express a gap that a bare way-id list
   *  could not. */
  legs: PatternLeg[];
  /** Optional label for a specific branch/variant, e.g. "via Airport". */
  name?: string;
}

/** One named headway period within a service's full schedule — "Peak",
 *  "Off-Peak", "Weekend", etc. GTFS `frequencies.txt`-shaped (a headway +
 *  a time window), not explicit per-trip stop_times: real enough to plan
 *  around, without exploding into a per-stop timetable editor. */
export interface SchedulePeriod {
  id: string;
  label: string;
  days: ScheduleDayScope;
  /** First and last departure this period covers, 24h "HH:MM". */
  spanStart: string;
  spanEnd: string;
  /** Headway in minutes — how often a vehicle departs during this period. */
  frequencyMinutes: number;
}

/** A colored route that people ride, running over one or more patterns
 *  (paths) — a plain line has exactly one; a branch has two or more. */
export interface Service {
  id: string;
  name: string;
  /** Mode catalog id: "subway" | "bus" | "tram" | "gondola" | … */
  modeId: string;
  /** A specific VehicleKind (system.vehicleKinds) this service runs —
   *  unset (the common case) uses the mode's plain default size/speed. */
  vehicleKindId?: string;
  /** Hex color, e.g. "#e4572e". */
  color: string;
  patterns: Pattern[];
  /** Peak headway in minutes — how often a vehicle departs at the busiest
   *  time of day. Undefined = not yet specified. This is the quick,
   *  always-present control (Inspector's "Peak headway" field, and what
   *  vehicle animation falls back to); `schedule` below is the optional,
   *  more detailed alternative — when present, it supersedes this pair for
   *  anything schedule-aware, and the Inspector's simple fields become a
   *  read-only summary pointing at "Edit full schedule" instead. */
  frequencyMinutes?: number;
  /** Span of service — first and last departure, 24h "HH:MM". */
  spanStart?: string;
  spanEnd?: string;
  /** Optional detailed schedule — multiple named headway periods (e.g. Peak
   *  vs. Off-Peak vs. Weekend) instead of one flat headway+span. Undefined
   *  or empty = this service just uses frequencyMinutes/spanStart/spanEnd
   *  above. See ScheduleDialog.tsx. */
  schedule?: SchedulePeriod[];
}
