// How often something actually turns up at a stop, once every route serving it
// is counted together.
//
// Two 10-minute routes down the same corridor are a 5-minute service to anyone
// standing between them, and that is the single most useful number a transit
// planner gets out of drawing overlapping lines — but nothing in the editor
// said it, because headway is stored per service and nobody was adding them up.
//
// This is ANALYSIS over the same schedule data the animation resolves against,
// not a measurement taken off the animation: exact, instant, and available
// without watching the map. The two are independent paths to the same number,
// which makes each a check on the other.
//
// Pure, like the rest of packages/core/src/sim.

import { INTERCHANGE_METERS, serviceWayIds, servedWayIds } from '../model/geo';
import type { Service, Station, Way } from '../model/system';

/**
 * Every service that calls at this station.
 *
 * Interchange is derived by proximity rather than stored (see the data model),
 * so this asks which ways pass within INTERCHANGE_METERS and then which
 * services run over them. It goes through `servedWayIds`, which is backed by
 * the segment spatial grid — a naive scan of every way for every station is
 * the exact O(n²) that froze the editor on RTC's real feed.
 *
 * Takes ways and services rather than the whole system so the inspector can
 * keep selecting narrowly: `system` is a fresh reference on every mutation,
 * including drag frames of an unrelated way.
 */
export function servicesAtStation(ways: Way[], services: Service[], station: Station): Service[] {
  const nearWays = new Set(servedWayIds(station.coord, ways, INTERCHANGE_METERS));
  return services.filter((service) => serviceWayIds(service).some((wayId) => nearWays.has(wayId)));
}

/** Departures per hour implied by a headway in minutes. */
export function vehiclesPerHour(headwaysMinutes: number[]): number {
  let perHour = 0;
  for (const headway of headwaysMinutes) if (headway > 0) perHour += 60 / headway;
  return perHour;
}

/**
 * The headway a rider actually experiences when several routes serve them.
 *
 * Frequencies add; headways don't. Two 10-minute routes are twelve vehicles an
 * hour, so five minutes apart — not twenty. Returns null when nothing counted
 * has a frequency, which is different from "very infrequent".
 *
 * This assumes the routes are useful for the same trip and that their
 * departures aren't deliberately coordinated with each other. Both are fair
 * for the frequent, turn-up-and-go service this models, and the UI says so
 * rather than leaving it implied.
 */
export function combinedHeadwayMinutes(headwaysMinutes: number[]): number | null {
  const perHour = vehiclesPerHour(headwaysMinutes);
  return perHour > 0 ? 60 / perHour : null;
}

/**
 * How long a rider who turns up without consulting a timetable waits, on
 * average: half the headway. True for uncoordinated arrivals, which is the
 * same assumption combinedHeadwayMinutes makes.
 */
export function typicalWaitMinutes(headwayMinutes: number): number {
  return headwayMinutes / 2;
}
