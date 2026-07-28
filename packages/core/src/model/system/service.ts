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
export interface PatternLeg {
  wayId: string;
  /** Traversed with increasing point index. Stored rather than derived: the
   *  geometry cannot always determine it (a single-way pattern, a neighbour
   *  sharing both endpoints), and a wrong guess used to mean "wrong lane" but
   *  now means "the wrong half of the way". geo/servicePaths.ts's
   *  deriveLegDirections supplies it wherever a caller has only geometry. */
  forward: boolean;
  /** Where the pattern enters and leaves this way, as normalized arc-length
   *  along the way's own resolved path — the same 0-at-the-first-point
   *  convention as StationAnchor.t, NOT travel order, so `forward` stays the
   *  only thing that says which direction. Undefined means the way's own
   *  start/end, which is the normal case: only a leg where the pattern
   *  genuinely begins or ends mid-way carries them. */
  fromT?: number;
  toT?: number;
  /** Which lane of this way the pattern rides (a LaneSpec.id). Undefined →
   *  resolve the default at render time (the rightmost travel lane in the
   *  direction of travel, or a dedicated bus lane / the direction's track —
   *  see profile.ts `defaultLaneFor`). Set only where the user or an import
   *  pinned a non-default lane. */
  laneId?: string;
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
