// Pure, data-oriented vehicle-motion kernel — no DOM, no MapLibre, no store, no
// allocation beyond the returned value. This is the numeric core of the ambient
// vehicle animation; apps/web/src/sim/vehicles.ts is the requestAnimationFrame /
// MapLibre HOST that drives it. Kept here in packages/core, framework-free and
// operating on plain numbers, so it's straightforward to port to WebAssembly
// later (the planned direction) without dragging any web/runtime dependency
// along. Pairs with geo/measurement.ts's pointAtDistance (distance → coordinate).

/** ~40 km/h — a plausible light-rail / tram / bus running speed. */
export const VEHICLE_SPEED_MPS = 11;

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

export function buildTimetable(
  totalMeters: number,
  stops: DwellStop[],
  speedMps: number = VEHICLE_SPEED_MPS,
): Timetable {
  const travelMs = (totalMeters / speedMps) * 1000;
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
 */
export function metersAtElapsed(
  timetable: Timetable,
  elapsedMs: number,
  speedMps: number = VEHICLE_SPEED_MPS,
): number {
  const totalMeters = timetable.totalMeters;
  let clock = 0;
  let lastDist = 0;
  for (const stop of timetable.stops) {
    const legMs = ((stop.distMeters - lastDist) / speedMps) * 1000;
    if (elapsedMs < clock + legMs) return lastDist + ((elapsedMs - clock) / 1000) * speedMps;
    clock += legMs;
    if (elapsedMs < clock + stop.dwellMs) return stop.distMeters; // dwelling — holds position
    clock += stop.dwellMs;
    lastDist = stop.distMeters;
  }
  return Math.min(totalMeters, lastDist + ((elapsedMs - clock) / 1000) * speedMps);
}
