// How often an imported route actually runs.
//
// GTFS import used to keep geometry, names and colors and throw every time
// away, so a real agency's network animated as one vehicle per route no matter
// how frequent the service was — the simulation had nothing to run on. This
// recovers a headway and a span of service per route.
//
// Two sources, in order of trust:
//
//   1. `frequencies.txt`, when the feed publishes it. That file IS a headway
//      and a time window, stated by the agency, so it maps onto SchedulePeriod
//      exactly and nothing has to be inferred.
//   2. Otherwise the departure times in `stop_times.txt`, which describe every
//      individual trip. The headway is then a MEASUREMENT of the timetable
//      rather than a statement of intent, so this module is careful about
//      which trips it measures and says so below.
//
// Pure and CSV-agnostic: it takes already-parsed rows so apps/web/scripts/
// verify.ts can drive it directly with fixture data.

import type { SchedulePeriod } from './system/service';
import type { ScheduleDayScope } from './system/valueTypes';
import { shortId } from './ids';

/** What one route was found to run, in the shape Service stores. */
export interface DerivedServiceLevel {
  frequencyMinutes?: number;
  spanStart?: string;
  spanEnd?: string;
  schedule?: SchedulePeriod[];
}

/**
 * "HH:MM:SS" → seconds after midnight.
 *
 * GTFS times legitimately run past 24:00:00: a trip leaving at 25:10:00 is
 * 01:10 the next morning, still counted as the previous service day. Those are
 * kept as-is here (they exceed 86400) so gaps between consecutive departures
 * stay correct across midnight; only formatting wraps them.
 */
export function parseGtfsTime(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Seconds after midnight → the "HH:MM" the schedule model stores, wrapping
 *  any past-midnight time back into a real clock reading. */
export function formatGtfsTime(seconds: number): string {
  const wrapped = ((Math.round(seconds / 60) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/**
 * The typical gap between departures, in whole minutes.
 *
 * The MEDIAN gap, not the mean, and not the span divided by the trip count.
 * A route's departures are not evenly spread — a weekday timetable is dense at
 * peak and thin at midday, and there is usually one enormous gap overnight.
 * A mean is dragged upward by that single gap; span-over-count is dragged the
 * same way. The median describes what a rider actually waits for most of the
 * day, which is what a headway is meant to mean.
 *
 * Returns null for fewer than two departures — one trip a day has no headway,
 * and inventing one would be worse than admitting that.
 */
export function medianHeadwayMinutes(departureSeconds: number[]): number | null {
  if (departureSeconds.length < 2) return null;
  const sorted = [...departureSeconds].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
  return Math.max(1, Math.round(median / 60));
}

/** GTFS `direction_id` splits a route's trips into its two directions. A
 *  headway is per direction — counting both together reports twice the real
 *  frequency, since a rider going one way can't use the other. Absent
 *  direction_id, everything falls in one bucket, which is the best available
 *  reading of a feed that doesn't distinguish them. */
function directionOf(trip: Record<string, string>): string {
  return trip.direction_id ?? '';
}

interface TripRow {
  tripId: string;
  routeId: string;
  serviceId: string;
  direction: string;
}

/**
 * Which service_id to measure, per route: the one running the most trips.
 *
 * A feed's trips span weekdays, Saturdays, Sundays and holidays under
 * different service_ids, and `calendar.txt` — which says what each one means —
 * isn't imported. Measuring all of them together would blend a weekday peak
 * with a Sunday timetable and report a frequency no day actually runs. The
 * busiest service_id is, in every real feed, the ordinary weekday one, so this
 * derives "what this route does on a normal day" and says so in the UI rather
 * than pretending to know the calendar.
 */
function dominantServiceId(trips: TripRow[]): string | null {
  const counts = new Map<string, number>();
  for (const t of trips) counts.set(t.serviceId, (counts.get(t.serviceId) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [serviceId, count] of counts) {
    // Ties break on the id so a feed that reorders its rows can't change what
    // gets imported.
    if (count > bestCount || (count === bestCount && best !== null && serviceId < best)) {
      best = serviceId;
      bestCount = count;
    }
  }
  return best;
}

export interface DeriveServiceLevelsInput {
  trips: Record<string, string>[];
  stopTimes: Record<string, string>[];
  /** Optional — most feeds omit it, and it is authoritative when present. */
  frequencies?: Record<string, string>[];
}

/**
 * Work out what every route runs, keyed by route_id.
 *
 * One pass over stop_times (the big file — hundreds of thousands of rows on a
 * real feed), keeping only each trip's FIRST departure. That single time is
 * all a headway needs: the gap between successive trips leaving the terminal.
 */
export function deriveServiceLevels(
  input: DeriveServiceLevelsInput,
): Map<string, DerivedServiceLevel> {
  const tripById = new Map<string, TripRow>();
  for (const t of input.trips) {
    if (!t.trip_id || !t.route_id) continue;
    tripById.set(t.trip_id, {
      tripId: t.trip_id,
      routeId: t.route_id,
      serviceId: t.service_id ?? '',
      direction: directionOf(t),
    });
  }

  // trip_id -> earliest departure seen, by stop_sequence.
  const firstDeparture = new Map<string, { seq: number; seconds: number }>();
  for (const st of input.stopTimes) {
    const tripId = st.trip_id;
    if (!tripId || !tripById.has(tripId)) continue;
    const seconds = parseGtfsTime(st.departure_time ?? st.arrival_time);
    if (seconds === null) continue;
    const seq = Number(st.stop_sequence) || 0;
    const prev = firstDeparture.get(tripId);
    if (!prev || seq < prev.seq) firstDeparture.set(tripId, { seq, seconds });
  }

  const byRoute = new Map<string, TripRow[]>();
  for (const trip of tripById.values()) {
    if (!byRoute.has(trip.routeId)) byRoute.set(trip.routeId, []);
    byRoute.get(trip.routeId)!.push(trip);
  }

  const fromFrequencies = frequencyPeriodsByRoute(input.frequencies ?? [], tripById);

  const result = new Map<string, DerivedServiceLevel>();
  for (const [routeId, trips] of byRoute) {
    const stated = fromFrequencies.get(routeId);
    if (stated && stated.length > 0) {
      result.set(routeId, {
        schedule: stated,
        // The flat fields stay in step with the detailed schedule, so the
        // Inspector's quick summary isn't blank for an imported route.
        frequencyMinutes: Math.min(...stated.map((p) => p.frequencyMinutes)),
        spanStart: stated[0].spanStart,
        spanEnd: stated[stated.length - 1].spanEnd,
      });
      continue;
    }

    const serviceId = dominantServiceId(trips);
    const measured = trips.filter((t) => t.serviceId === serviceId);
    // Per direction, so a two-way route doesn't report double its frequency.
    const byDirection = new Map<string, number[]>();
    for (const t of measured) {
      const dep = firstDeparture.get(t.tripId);
      if (!dep) continue;
      if (!byDirection.has(t.direction)) byDirection.set(t.direction, []);
      byDirection.get(t.direction)!.push(dep.seconds);
    }
    if (byDirection.size === 0) continue;

    // The busiest direction sets the headway — it is the one with a full
    // timetable when a route runs a short-turn or a one-way loop back.
    let departures: number[] = [];
    for (const times of byDirection.values())
      if (times.length > departures.length) departures = times;

    const headway = medianHeadwayMinutes(departures);
    const all = [...byDirection.values()].flat().sort((a, b) => a - b);
    const level: DerivedServiceLevel = {
      spanStart: formatGtfsTime(all[0]),
      spanEnd: formatGtfsTime(all[all.length - 1]),
    };
    if (headway !== null) level.frequencyMinutes = headway;
    result.set(routeId, level);
  }
  return result;
}

/** frequencies.txt rows grouped into SchedulePeriods per route. Each row is
 *  already a headway plus a window, so this only has to attach them to the
 *  right route and sort them into the order of the day. */
function frequencyPeriodsByRoute(
  rows: Record<string, string>[],
  tripById: Map<string, TripRow>,
): Map<string, SchedulePeriod[]> {
  const byRoute = new Map<string, { start: number; end: number; headwayMinutes: number }[]>();
  for (const row of rows) {
    const trip = row.trip_id ? tripById.get(row.trip_id) : undefined;
    if (!trip) continue;
    const start = parseGtfsTime(row.start_time);
    const end = parseGtfsTime(row.end_time);
    const headwaySecs = Number(row.headway_secs);
    if (start === null || end === null || !Number.isFinite(headwaySecs) || headwaySecs <= 0)
      continue;
    const headwayMinutes = Math.max(1, Math.round(headwaySecs / 60));
    if (!byRoute.has(trip.routeId)) byRoute.set(trip.routeId, []);
    const windows = byRoute.get(trip.routeId)!;
    // A route runs the same window once per direction; keep it once.
    if (
      windows.some((w) => w.start === start && w.end === end && w.headwayMinutes === headwayMinutes)
    )
      continue;
    windows.push({ start, end, headwayMinutes });
  }

  const periods = new Map<string, SchedulePeriod[]>();
  for (const [routeId, windows] of byRoute) {
    windows.sort((a, b) => a.start - b.start);
    periods.set(
      routeId,
      windows.map((w) => ({
        id: shortId(),
        label: periodLabel(w.start),
        days: 'daily' as ScheduleDayScope,
        spanStart: formatGtfsTime(w.start),
        spanEnd: formatGtfsTime(w.end),
        frequencyMinutes: w.headwayMinutes,
      })),
    );
  }
  return periods;
}

/** A readable name for a window, from when it starts. frequencies.txt carries
 *  no labels, and "Period 3" tells a reader nothing — these are the names the
 *  scenario picker will show. */
function periodLabel(startSeconds: number): string {
  const hour = Math.floor((((startSeconds / 3600) % 24) + 24) % 24);
  if (hour < 6) return 'Night';
  if (hour < 9) return 'AM peak';
  if (hour < 15) return 'Midday';
  if (hour < 19) return 'PM peak';
  return 'Evening';
}
