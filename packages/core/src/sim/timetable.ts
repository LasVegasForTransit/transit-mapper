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
  stops: DwellStop[];
}

export function buildTimetable(totalMeters: number, stops: DwellStop[], speedMps: number = VEHICLE_SPEED_MPS): Timetable {
  const travelMs = (totalMeters / speedMps) * 1000;
  const dwellMs = stops.reduce((sum, s) => sum + s.dwellMs, 0);
  return { oneWayMs: travelMs + dwellMs, stops };
}

/**
 * Where a vehicle sits (meters from the path's start) after `elapsedMs` of
 * ONE-DIRECTION travel from t=0, walking leg by leg through each stop's travel
 * segment then its dwell pause. Elapsed time past the last stop covers the final
 * leg into the path's end.
 */
export function metersAtElapsed(totalMeters: number, timetable: Timetable, elapsedMs: number, speedMps: number = VEHICLE_SPEED_MPS): number {
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
