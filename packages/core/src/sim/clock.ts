// The simulated clock: the one number the whole simulator resolves against,
// plus the calendar math that turns it into "what time is it, and what is
// running right now".
//
// Pure and framework-free, like its neighbour timetable.ts — no Date, no
// performance.now, no timers. Simulated time arrives as an argument and leaves
// as a return value, which is what makes the simulator a FUNCTION of time
// rather than a thing that has to be run: the same simMs always resolves to
// the same map, so pausing, jumping to 5 PM, and running at 4x are all the
// same operation, and every rule below is testable without a browser.
//
// apps/web/src/sim/simClock.ts is the host that owns the mutable number and
// advances it from real elapsed time.

import type { Service } from '../model/system/service';
import type { ScheduleDayScope } from '../model/system/valueTypes';

export const MS_PER_MINUTE = 60_000;
export const MINUTES_PER_DAY = 24 * 60;
export const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

/** One entry on the speed ladder. `simPerReal` is how many simulated seconds
 *  pass per real second — the only field the sim itself reads; the rest is
 *  how the control describes itself. */
export interface SimSpeed {
  id: string;
  /** What the button says. */
  label: string;
  /** Simulated seconds per real second. */
  simPerReal: number;
  /** How long a full 24-hour day takes at this speed, for the tooltip — the
   *  honest way to describe speeds that sit close together. */
  dayLabel: string;
}

/**
 * Really slow → really fast, in the SimCity sense. `1x` is the anchor: one
 * real second is one simulated minute, so a day takes 24 real minutes. The
 * rest double from there, which keeps each step obviously different from its
 * neighbour — a ladder that instead ended on exactly "a day in 10 minutes"
 * would need a 2.4x top speed, indistinguishable from 2x in practice. 4x
 * finishes a day in six minutes, comfortably inside that target.
 */
export const SIM_SPEEDS: SimSpeed[] = [
  { id: 'realtime', label: 'Realtime', simPerReal: 1, dayLabel: 'a full day in 24 hours' },
  { id: '1x', label: '1×', simPerReal: 60, dayLabel: 'a full day in 24 minutes' },
  { id: '2x', label: '2×', simPerReal: 120, dayLabel: 'a full day in 12 minutes' },
  { id: '4x', label: '4×', simPerReal: 240, dayLabel: 'a full day in 6 minutes' },
];

export const DEFAULT_SIM_SPEED_ID = '1x';

export function simSpeed(id: string): SimSpeed {
  return SIM_SPEEDS.find((s) => s.id === id) ?? SIM_SPEEDS[1];
}

/** The speed one step slower/faster, clamped at the ends of the ladder — the
 *  keyboard's `,`/`.` and the intent behind a speed control that can't wrap
 *  from "really fast" round to "really slow" by accident. */
export function stepSimSpeed(id: string, direction: -1 | 1): string {
  const index = SIM_SPEEDS.findIndex((s) => s.id === id);
  const next = Math.min(SIM_SPEEDS.length - 1, Math.max(0, (index < 0 ? 1 : index) + direction));
  return SIM_SPEEDS[next].id;
}

// simMs 0 is Monday 00:00. The week is the shortest cycle that can express
// ScheduleDayScope's weekday/weekend split; nothing here models a date, a
// month, or a holiday, matching the deliberately coarse schedule model.
//
// Day names and time-of-day come from Intl rather than a hardcoded English
// table: the platform already knows what a Tuesday is called and whether this
// reader writes 17:05 or 5:05 PM, and getting that from a literal array would
// mean shipping a worse answer in every locale but one. Anchored to a real
// Monday in UTC (1970-01-05 — the epoch itself was a Thursday) and formatted
// in UTC, so the host machine's own time zone can never shift which day a
// simulated Monday prints as.
const WEEK_ANCHOR_UTC = Date.UTC(1970, 0, 5);

// Intl.DateTimeFormat construction is the expensive part; these get called
// from a render at a few Hz, so keep one formatter per locale.
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = locale ?? '';
  let formatter = cache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    cache.set(key, formatter);
  }
  return formatter;
}

/** The reader's own short name for a day of the week, 0 = Monday. */
export function weekdayLabel(dayIndex: number, locale?: string): string {
  return formatterFor(weekdayFormatters, locale, { weekday: 'short' }).format(
    WEEK_ANCHOR_UTC + dayIndex * MS_PER_DAY,
  );
}

/** Minutes since midnight as the reader's own clock reads it — 24-hour or
 *  12-hour with AM/PM, whichever their locale uses. A padded hour (rather
 *  than "numeric") keeps the readout the same width from 09:59 to 10:00,
 *  which matters for text that updates several times a second next to
 *  buttons people are aiming at. */
export function formatTimeOfDay(minutes: number, locale?: string): string {
  return formatterFor(timeFormatters, locale, { hour: '2-digit', minute: '2-digit' }).format(
    WEEK_ANCHOR_UTC + minutes * MS_PER_MINUTE,
  );
}

/** Monday 08:00 — where a fresh session starts. Deliberately mid-morning: a
 *  new line defaults to a 06:00–23:00 span, so starting at midnight would
 *  open onto an empty map and read as "the simulation is broken". */
export const DEFAULT_SIM_START_MS = 8 * 60 * MS_PER_MINUTE;

/** Advance the clock. `realDeltaMs` is wall-clock time actually elapsed;
 *  pass 0 (or a speed of 0) to hold. Negative deltas are ignored rather than
 *  rewinding — a monotonic clock means a run can never observe time going
 *  backwards, which is the one assumption the run-cycle math makes. */
export function advanceSimMs(simMs: number, realDeltaMs: number, simPerReal: number): number {
  if (!(realDeltaMs > 0) || !(simPerReal > 0)) return simMs;
  return simMs + realDeltaMs * simPerReal;
}

/** Minutes since midnight, 0–1439. */
export function minutesOfDay(simMs: number): number {
  const intoDay = ((simMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  return Math.floor(intoDay / MS_PER_MINUTE);
}

/** Day index within the week, 0 = Monday. */
export function dayOfWeek(simMs: number): number {
  return Math.floor(
    (((simMs % (7 * MS_PER_DAY)) + 7 * MS_PER_DAY) % (7 * MS_PER_DAY)) / MS_PER_DAY,
  );
}

/** Which schedule periods apply today. Never returns "daily" — that scope
 *  means "both", and is matched against this rather than equal to it. */
export function dayScopeAt(simMs: number): ScheduleDayScope {
  return dayOfWeek(simMs) >= 5 ? 'weekend' : 'weekday';
}

/** The simulated instant as a reader in `locale` would write it — "Mon 08:42",
 *  "lun. 08:42", "Mon 8:42 AM". Both halves come from Intl; see the anchor
 *  comment above for why this can't be a lookup table. */
export function formatSimClock(simMs: number, locale?: string): string {
  return `${weekdayLabel(dayOfWeek(simMs), locale)} ${formatTimeOfDay(minutesOfDay(simMs), locale)}`;
}

/** "HH:MM" → minutes since midnight, or null if it isn't one. Schedule spans
 *  are user-typed strings, so this rejects rather than coerces: a malformed
 *  span should read as "no span set", not as midnight. */
export function parseHhMm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Is `nowMin` inside a span? A span whose end is at or before its start wraps
 * past midnight — "23:00" to "01:00" is a two-hour late-night span, not an
 * empty or backwards one. Both ends are inclusive of the start and exclusive
 * of the end, so back-to-back periods (06:00–09:00, 09:00–15:00) hand off
 * cleanly with no minute belonging to both.
 */
export function isWithinSpan(nowMin: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return true; // a zero-length span reads as all day
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

/** What a service is running right now. `headwayMinutes` is absent when the
 *  service is running but has never had a frequency set — which is every
 *  GTFS-imported route, since import brings in no timing. */
export interface ActiveSchedule {
  headwayMinutes?: number;
  /** The SchedulePeriod this came from, when it came from one — so the UI can
   *  say "every 8 min (Peak)" rather than just a number. */
  label?: string;
}

/**
 * Is this service running at this moment, and how often?
 *
 * `null` means it isn't running — outside its span of service, or (with a
 * scenario pinned) it has no period by that name. The caller draws nothing.
 *
 * Resolution order, matching how the data is documented to layer:
 *
 * 1. A detailed `schedule` supersedes the flat fields. The first period whose
 *    day scope and span both cover now wins.
 * 2. Otherwise `frequencyMinutes`, bounded by `spanStart`/`spanEnd`.
 * 3. A service with nothing set at all runs all day with no stated frequency.
 *    That has always been its behavior and this must not change it.
 *
 * `pinnedLabel` is the sandbox mode: pin "Peak" and every service runs its
 * peak configuration whatever the clock says, for comparing service levels
 * without waiting for the right hour. A pinned scenario ignores spans by
 * design — that's the whole point of pinning one.
 */
export function activeSchedule(
  service: Service,
  nowMin: number,
  dayScope: ScheduleDayScope,
  pinnedLabel?: string,
): ActiveSchedule | null {
  const periods = service.schedule;
  if (periods && periods.length > 0) {
    if (pinnedLabel !== undefined) {
      const pinned = periods.find((p) => p.label.toLowerCase() === pinnedLabel.toLowerCase());
      // A service with a schedule but no period by that name genuinely does
      // not run in that scenario (a weekday-only express under "Weekend").
      return pinned ? { headwayMinutes: pinned.frequencyMinutes, label: pinned.label } : null;
    }
    for (const period of periods) {
      if (period.days !== 'daily' && period.days !== dayScope) continue;
      const start = parseHhMm(period.spanStart);
      const end = parseHhMm(period.spanEnd);
      if (start === null || end === null) continue; // unparseable span: skip, don't guess
      if (isWithinSpan(nowMin, start, end))
        return { headwayMinutes: period.frequencyMinutes, label: period.label };
    }
    return null;
  }

  const start = service.spanStart !== undefined ? parseHhMm(service.spanStart) : null;
  const end = service.spanEnd !== undefined ? parseHhMm(service.spanEnd) : null;
  const spanned = start !== null && end !== null;
  if (pinnedLabel === undefined && spanned && !isWithinSpan(nowMin, start, end)) return null;
  return { headwayMinutes: service.frequencyMinutes };
}
