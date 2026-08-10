import type { ScheduleDayScope } from './valueTypes';

/** The public identity a transportation agency designates on its map. */
export interface Line {
  id: string;
  name: string;
  color: string;
  serviceIds: string[];
}

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

/** Which of a line's two directions of service is being asked about. NOT the
 *  same axis as LegDirection: that one is about a way's stored point order,
 *  this one is about which trip a rider is on. sim/fleet.ts's RunPhase is
 *  built from this so the two vocabularies cannot drift apart. */
export type RunDirection = 'outbound' | 'inbound';

/**
 * One stretch of a pattern, and which directions of service ride it.
 *
 * A section rather than a per-leg tag, because the alternative cannot express
 * the constraint that matters. Tagging legs in one flat array makes an
 * inbound-only leg's POSITION load-bearing — put it after the shared leg it
 * should precede and the return path silently reads discontinuous — and the
 * type permits both spellings, so only a validator tells them apart. Here the
 * two halves of a couplet are held by the object containing them, and the
 * broken spelling cannot be written.
 *
 * - `shared` — both directions ride these legs, the return one flipped. Every
 *   pattern in every document before v12 is exactly one of these, which is why
 *   nothing about an existing line changes.
 * - `split` — the directions part company: a one-way couplet, or a stretch one
 *   direction skips. The two leg lists are each in their OWN ride order.
 * - `turnaround` — ridden once, at the point the vehicle reverses. A loop
 *   round a block at a terminus, which belongs to neither direction.
 */
export type PatternSection =
  | { kind: 'shared'; legs: PatternLeg[] }
  | { kind: 'split'; outbound: PatternLeg[]; inbound: PatternLeg[] }
  | { kind: 'turnaround'; legs: PatternLeg[] };

/** One operational path. A Service owns exactly one; agency-designated Lines
 *  group sibling Services when multiple paths share a public identity.
 *
 *  Directions are still two runs of ONE path (see PatternSection), because
 *  they share a stop derivation, headway, and fleet. */
export interface Pattern {
  id: string;
  /** The pattern's path, in sections ordered along OUTBOUND travel.
   *
   *  The outbound run reads them in order, taking `legs` or `outbound`. The
   *  inbound run reads them in REVERSE, taking `legs` or `inbound`, reversed
   *  within each section and each leg's travel direction flipped.
   *
   *  Consecutive legs must meet WITHIN a direction; validate.ts walks each
   *  direction separately, since a couplet's two halves deliberately do not
   *  touch. */
  sections: PatternSection[];
  /**
   * Stations this pattern passes but does NOT call at, per direction.
   *
   * The one exception to derived stops, and it exists for exactly one case: a
   * stop on a stretch BOTH directions ride, served in one direction only. That
   * stretch is one `shared` section, so there is nothing per-direction to hang
   * the omission on and nothing else in the model can say it. Where the two
   * directions ride different ways — a couplet — the derivation already gets
   * it right and this is not involved.
   *
   * A denylist rather than a list of the stops that ARE served, because stops
   * are derived: adding a station to a corridor adds it to every line running
   * past, which is the behaviour the whole model is built on. An explicit
   * served-list would have to be maintained by every station edit anywhere,
   * and a stale one silently LOSES stops. A denylist can only go stale by
   * naming a station that no longer exists, which the parser drops.
   *
   * Absent — the case for every pattern in every document before v13 — skips
   * nothing.
   */
  skippedStops?: Partial<Record<RunDirection, string[]>>;
}

/** The one operational path owned by a Service. Its id matches the Service id
 *  so existing geometry operations can address the path without introducing
 *  a second identity. */
export type ServicePath = Pattern;

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

/** One mode-specific operation beneath a public Line. */
export interface Service {
  id: string;
  /** Required only when a Line has multiple Services to distinguish. */
  name?: string;
  /** Mode catalog id: "subway" | "bus" | "tram" | "gondola" | … */
  modeId: string;
  /** A specific VehicleKind (system.vehicleKinds) this service runs —
   *  unset (the common case) uses the mode's plain default size/speed. */
  vehicleKindId?: string;
  path: ServicePath;
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
