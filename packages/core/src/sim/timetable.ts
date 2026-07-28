// Pure, data-oriented vehicle-motion kernel — no DOM, no MapLibre, no store, no
// allocation beyond the returned value. This is the numeric core of the ambient
// vehicle animation; apps/web/src/sim/vehicles.ts is the requestAnimationFrame /
// MapLibre HOST that drives it. Kept here in packages/core, framework-free and
// operating on plain numbers, so it's straightforward to port to WebAssembly
// later (the planned direction) without dragging any web/runtime dependency
// along. Pairs with geo/measurement.ts's pointAtDistance (distance → coordinate).
//
// A vehicle covers each leg (route start to first stop, stop to stop, last
// stop to route end) as an independent start-from-rest, arrive-at-rest
// kinematic move — a trapezoidal speed profile (accelerate, cruise at top
// speed, decelerate) when the leg is long enough to reach top speed, or a
// triangular one (accelerate to some peak below top speed, then immediately
// decelerate) when it isn't. Every leg genuinely starts and ends stationary —
// a dwell holds position, and so does layover — so no velocity carries across
// a leg boundary, and each leg's shape depends only on its own distance and
// the vehicle's profile. That keeps this a pure function of elapsed time, with
// no per-vehicle state, which is what lets the rest of the simulator stay
// "resolved" rather than stepped (see docs/product/explanation/simulation.md).

/** ~40 km/h — a plausible light-rail/tram/bus running speed. */
export const VEHICLE_SPEED_MPS = 11;

/** Plausible light-rail/tram/bus acceleration — 0 to VEHICLE_SPEED_MPS in
 *  about 9 seconds. */
export const VEHICLE_ACCEL_MPS2 = 1.2;

/** Plausible service-braking rate. Higher than VEHICLE_ACCEL_MPS2, which
 *  holds for most rail and bus vehicles: braking is faster than speeding up. */
export const VEHICLE_DECEL_MPS2 = 1.5;

/** Top speed, and how fast a vehicle reaches or sheds it — the three numbers
 *  a motion calculation needs, bundled so callers thread one value instead of
 *  three that would otherwise have to change in lockstep. */
export interface VehicleMotionProfile {
  /** Cruising speed once fully up to speed, in m/s. */
  speedMps: number;
  /** Rate of speeding up from rest, in m/s². */
  accelMps2: number;
  /** Rate of slowing to a stop, in m/s². */
  decelMps2: number;
}

/** The profile every vehicle used before it could be tuned per vehicle kind,
 *  and what an unassigned service still falls back to. */
export const DEFAULT_MOTION_PROFILE: VehicleMotionProfile = {
  speedMps: VEHICLE_SPEED_MPS,
  accelMps2: VEHICLE_ACCEL_MPS2,
  decelMps2: VEHICLE_DECEL_MPS2,
};

export interface DwellStop {
  /** Arc-length distance from the pattern path's start, in meters. */
  distMeters: number;
  dwellMs: number;
}

export interface Timetable {
  /** Total wall-clock ms to cover the path start→end, stops included. */
  oneWayMs: number;
  /** The length of the path this timetable was built against.
   *
   *  Held here rather than passed in alongside, because a line's two
   *  directions no longer have to be the same length: a one-way couplet's
   *  return trip is a different street. metersAtElapsed used to take this as
   *  an argument, which let a caller walk one direction's clock against the
   *  other direction's ruler and get a position that belongs to neither. */
  totalMeters: number;
  stops: DwellStop[];
}

/** Both directions of one line. Two timetables, not one mirrored: a couplet's
 *  return trip has its own length and its own stops at its own distances. For
 *  a line that comes back the way it went, the two are mirror images, which is
 *  a fact worth testing rather than a shortcut worth taking. */
export interface RunTimetables {
  outbound: Timetable;
  inbound: Timetable;
}

/** The full out-and-back time. Was `2 * oneWayMs`, which is still exactly what
 *  it comes to for a line whose two directions ride the same ground. */
export function roundTripMs(timetables: RunTimetables): number {
  return timetables.outbound.oneWayMs + timetables.inbound.oneWayMs;
}

/** The shape of one leg's speed profile: how long each phase takes, and the
 *  fastest the vehicle actually gets to go — `speedMps` on a leg long enough
 *  to reach it, something slower when the distance is too short (the whole
 *  point of a leg-local kinematic profile instead of an instant speed change:
 *  closely-spaced stops now correctly never reach top speed at all). */
interface LegProfile {
  /** Total time to cover the leg, ms. */
  durationMs: number;
  /** When the accelerating phase ends, ms into the leg. Also where the
   *  cruise phase (if any) ends, on a leg too short to have one. */
  accelEndMs: number;
  /** When the cruise phase ends and decelerating begins, ms into the leg.
   *  Equal to `accelEndMs` when there is no cruise phase. */
  cruiseEndMs: number;
  /** Distance covered by the end of the accelerating phase, meters. */
  accelEndMeters: number;
  /** The fastest speed reached on this leg, m/s — `speedMps` unless the leg
   *  is too short to reach it. */
  peakSpeedMps: number;
}

function legProfile(distMeters: number, profile: VehicleMotionProfile): LegProfile {
  const { speedMps, accelMps2, decelMps2 } = profile;
  const accelDist = (speedMps * speedMps) / (2 * accelMps2);
  const decelDist = (speedMps * speedMps) / (2 * decelMps2);
  if (accelDist + decelDist <= distMeters) {
    const accelMs = (speedMps / accelMps2) * 1000;
    const decelMs = (speedMps / decelMps2) * 1000;
    const cruiseMs = ((distMeters - accelDist - decelDist) / speedMps) * 1000;
    return {
      durationMs: accelMs + cruiseMs + decelMs,
      accelEndMs: accelMs,
      cruiseEndMs: accelMs + cruiseMs,
      accelEndMeters: accelDist,
      peakSpeedMps: speedMps,
    };
  }
  // Triangular: too short to reach top speed. Solve the one peak speed at
  // which accelerating in and braking out exactly covers the distance —
  // accelDist(peak) + decelDist(peak) = distMeters.
  const peak = Math.sqrt((2 * distMeters * accelMps2 * decelMps2) / (accelMps2 + decelMps2));
  const accelMs = (peak / accelMps2) * 1000;
  const decelMs = (peak / decelMps2) * 1000;
  return {
    durationMs: accelMs + decelMs,
    accelEndMs: accelMs,
    cruiseEndMs: accelMs,
    accelEndMeters: (peak * peak) / (2 * accelMps2),
    peakSpeedMps: peak,
  };
}

/** How long this leg takes to cover, under this motion profile. */
function legDurationMs(distMeters: number, profile: VehicleMotionProfile): number {
  return distMeters === 0 ? 0 : legProfile(distMeters, profile).durationMs;
}

/** How far into this leg the vehicle has gotten after `elapsedMs`. */
function legDistanceAtElapsed(
  distMeters: number,
  profile: VehicleMotionProfile,
  elapsedMs: number,
): number {
  if (distMeters === 0) return 0;
  const leg = legProfile(distMeters, profile);
  if (elapsedMs >= leg.durationMs) return distMeters;
  if (elapsedMs <= leg.accelEndMs) {
    const t = elapsedMs / 1000;
    return 0.5 * profile.accelMps2 * t * t;
  }
  if (elapsedMs < leg.cruiseEndMs) {
    return leg.accelEndMeters + leg.peakSpeedMps * ((elapsedMs - leg.accelEndMs) / 1000);
  }
  const remainingS = (leg.durationMs - elapsedMs) / 1000;
  return distMeters - 0.5 * profile.decelMps2 * remainingS * remainingS;
}

export function buildTimetable(
  totalMeters: number,
  stops: DwellStop[],
  profile: VehicleMotionProfile = DEFAULT_MOTION_PROFILE,
): Timetable {
  // Each leg's own travel time, summed — NOT totalMeters/speedMps in one
  // lump. Under constant speed those agree because legs are additive; once
  // each leg ramps up and down independently they no longer do, and this has
  // to walk the same leg list metersAtElapsed walks below, or the two would
  // silently disagree about how long the trip takes.
  let travelMs = 0;
  let lastDist = 0;
  for (const stop of stops) {
    travelMs += legDurationMs(stop.distMeters - lastDist, profile);
    lastDist = stop.distMeters;
  }
  travelMs += legDurationMs(totalMeters - lastDist, profile);
  const dwellMs = stops.reduce((sum, s) => sum + s.dwellMs, 0);
  return { oneWayMs: travelMs + dwellMs, totalMeters, stops };
}

/**
 * Where a vehicle sits (meters from the start of THIS timetable's own path)
 * after `elapsedMs` of travel from t=0, walking leg by leg through each stop's
 * travel segment then its dwell pause. Elapsed time past the last stop covers
 * the final leg into the path's end.
 *
 * One direction, and the timetable says which — the return trip is walked
 * FORWARD along its own timetable, not backwards along the outward one.
 *
 * `profile` must be the one the timetable was BUILT with, or the two disagree
 * and a vehicle arrives early (and sits clamped at the end) or never arrives
 * at all.
 */
export function metersAtElapsed(
  timetable: Timetable,
  elapsedMs: number,
  profile: VehicleMotionProfile = DEFAULT_MOTION_PROFILE,
): number {
  const totalMeters = timetable.totalMeters;
  let clock = 0;
  let lastDist = 0;
  for (const stop of timetable.stops) {
    const legDist = stop.distMeters - lastDist;
    const legMs = legDurationMs(legDist, profile);
    if (elapsedMs < clock + legMs) {
      return lastDist + legDistanceAtElapsed(legDist, profile, elapsedMs - clock);
    }
    clock += legMs;
    if (elapsedMs < clock + stop.dwellMs) return stop.distMeters; // dwelling — holds position
    clock += stop.dwellMs;
    lastDist = stop.distMeters;
  }
  const legDist = totalMeters - lastDist;
  return Math.min(
    totalMeters,
    lastDist + legDistanceAtElapsed(legDist, profile, elapsedMs - clock),
  );
}
