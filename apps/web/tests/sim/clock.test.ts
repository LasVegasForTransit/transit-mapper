import { describe, expect, it } from 'vitest';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import type { LngLat, Service, Stop, Way } from '@transitmapper/core/model/system';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import {
  activeSchedule,
  advanceSimMs,
  dayOfWeek,
  dayScopeAt,
  DEFAULT_SIM_SPEED_ID,
  DEFAULT_SIM_START_MS,
  formatSimClock,
  formatTimeOfDay,
  isWithinSpan,
  minutesOfDay,
  MS_PER_DAY,
  MS_PER_MINUTE,
  parseHhMm,
  schedulePeriodLabels,
  SIM_SPEEDS,
  simSpeed,
  stepSimSpeed,
  weekdayLabel,
} from '@transitmapper/core/sim/clock';
import {
  combinedHeadwayMinutes,
  servicesAtStop,
  typicalWaitMinutes,
  vehiclesPerHour,
} from '@transitmapper/core/sim/frequency';

/** Whole-way legs in stored point order. */
const legsOf = (...wayIds: string[]) => wayIds.map((wayId) => wholeLeg(wayId));

function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

// The whole simulator resolves against this one number, so the calendar math
// below is load-bearing for every later rule about what is running when.
describe('the simulated clock (core/sim/clock.ts)', () => {
  // The speed ladder, against the two properties it was designed around.
  it('the default speed runs one simulated minute per real second', () => {
    expect(simSpeed(DEFAULT_SIM_SPEED_ID).simPerReal).toBe(60);
  });
  it('the speed ladder only ever gets faster', () => {
    expect(SIM_SPEEDS.every((s, i) => i === 0 || s.simPerReal > SIM_SPEEDS[i - 1].simPerReal)).toBe(
      true,
    );
  });
  it('the fastest speed simulates a whole day inside ten real minutes', () => {
    const fastestRealMs = MS_PER_DAY / SIM_SPEEDS[SIM_SPEEDS.length - 1].simPerReal;
    expect(fastestRealMs).toBeLessThanOrEqual(10 * 60_000);
  });
  it('realtime is real time', () => {
    expect(SIM_SPEEDS[0].simPerReal).toBe(1);
  });
  it('an unknown speed id falls back to a usable speed rather than crashing', () => {
    expect(simSpeed('nonsense').simPerReal).toBeGreaterThan(0);
  });

  it('stepping the speed up moves one rung', () => {
    expect(stepSimSpeed('1x', 1)).toBe('2x');
  });
  it('stepping the speed down moves one rung', () => {
    expect(stepSimSpeed('2x', -1)).toBe('1x');
  });
  it("the slowest speed can't step below itself", () => {
    expect(stepSimSpeed(SIM_SPEEDS[0].id, -1)).toBe(SIM_SPEEDS[0].id);
  });
  it("the fastest speed can't wrap around to the slowest", () => {
    expect(stepSimSpeed(SIM_SPEEDS[SIM_SPEEDS.length - 1].id, 1)).toBe(
      SIM_SPEEDS[SIM_SPEEDS.length - 1].id,
    );
  });

  // Advancing.
  it('one real second at 1x advances one simulated minute', () => {
    expect(advanceSimMs(0, 1000, 60)).toBe(MS_PER_MINUTE);
  });
  it('a zero speed holds the clock', () => {
    expect(advanceSimMs(5000, 1000, 0)).toBe(5000);
  });
  it('the clock never runs backwards', () => {
    expect(advanceSimMs(5000, -1000, 60)).toBe(5000);
  });

  // Time of day and the week. simMs 0 is Monday 00:00.
  it('the clock starts mid-morning, not at midnight on an empty map', () => {
    expect(minutesOfDay(DEFAULT_SIM_START_MS)).toBe(8 * 60);
  });
  it('minutes of day wrap at midnight', () => {
    expect(minutesOfDay(MS_PER_DAY + 90 * MS_PER_MINUTE)).toBe(90);
  });
  it('day zero is Monday', () => {
    expect(dayOfWeek(0)).toBe(0);
  });
  it('the week wraps after seven days', () => {
    expect(dayOfWeek(7 * MS_PER_DAY)).toBe(0);
  });
  it('Monday through Friday are weekdays', () => {
    expect([0, 1, 2, 3, 4].every((d) => dayScopeAt(d * MS_PER_DAY) === 'weekday')).toBe(true);
  });
  it('Saturday and Sunday are the weekend', () => {
    expect([5, 6].every((d) => dayScopeAt(d * MS_PER_DAY) === 'weekend')).toBe(true);
  });

  // Day names and times come from Intl, not a hardcoded English table.
  it('weekday names are localized, not one hardcoded language', () => {
    expect(weekdayLabel(0, 'en-US')).not.toBe(weekdayLabel(0, 'fr-FR'));
  });
  it('a locale that writes 24-hour time gets 24-hour time', () => {
    expect(formatTimeOfDay(17 * 60 + 5, 'en-GB')).toBe('17:05');
  });
  it('a locale that writes 12-hour time gets 12-hour time', () => {
    expect(formatTimeOfDay(17 * 60 + 5, 'en-US')).toContain('05:05');
  });
  it("the hour is padded so the readout can't change width", () => {
    expect(formatTimeOfDay(9 * 60, 'en-GB').length).toBe(formatTimeOfDay(10 * 60, 'en-GB').length);
  });
  it('the clock reads as a day plus a time', () => {
    expect(formatSimClock(DEFAULT_SIM_START_MS, 'en-GB')).toBe('Mon 08:00');
  });
  it('the same weekday a week later reads the same', () => {
    expect(formatSimClock(0, 'en-GB')).toBe(formatSimClock(7 * MS_PER_DAY, 'en-GB'));
  });

  // "HH:MM" spans, as typed into the schedule editor.
  it('a span time parses to minutes since midnight', () => {
    expect(parseHhMm('06:30')).toBe(390);
  });
  it('a single-digit hour still parses', () => {
    expect(parseHhMm('6:30')).toBe(390);
  });
  it('a malformed span time is rejected rather than read as midnight', () => {
    expect(parseHhMm('nope')).toBeNull();
  });
  it('an impossible hour is rejected', () => {
    expect(parseHhMm('25:00')).toBeNull();
  });
  it('an impossible minute is rejected', () => {
    expect(parseHhMm('06:75')).toBeNull();
  });

  it('a time inside a span counts as running', () => {
    expect(isWithinSpan(8 * 60, 6 * 60, 23 * 60)).toBe(true);
  });
  it('a time before a span starts does not', () => {
    expect(isWithinSpan(5 * 60, 6 * 60, 23 * 60)).toBe(false);
  });
  it("a span's end minute belongs to the next period, not this one", () => {
    expect(isWithinSpan(23 * 60, 6 * 60, 23 * 60)).toBe(false);
  });
  it("a span's start minute belongs to it", () => {
    expect(isWithinSpan(6 * 60, 6 * 60, 23 * 60)).toBe(true);
  });
  it('a span crossing midnight is still running at 00:30', () => {
    expect(isWithinSpan(30, 23 * 60, 60)).toBe(true);
  });
  it('a span crossing midnight is not running at midday', () => {
    expect(isWithinSpan(12 * 60, 23 * 60, 60)).toBe(false);
  });
});

// Span of service and schedule periods were fully modeled, editable, and
// round-tripped through serialize.ts, and read by nothing. These are the rules
// that make them mean something on the map.
describe('what is running right now (activeSchedule)', () => {
  const base: Service = {
    id: 'as1',
    name: 'Route',
    modeId: 'bus',
    path: { id: 'as1', sections: [] },
  };
  const at = (hhmm: string) => mustFind(parseHhMm(hhmm), `a parseable time from "${hhmm}"`);

  // A service with nothing set at all runs all day. This is every
  // GTFS-imported route, and changing it would silently empty an imported map.
  it('a service with no schedule at all runs at any hour', () => {
    const bare = activeSchedule(base, at('03:00'), 'weekday');
    expect(bare).not.toBeNull();
  });
  it('…and states no headway, so it runs a single vehicle', () => {
    const bare = activeSchedule(base, at('03:00'), 'weekday');
    expect(bare?.headwayMinutes).toBeUndefined();
  });

  // The flat fields: a headway bounded by a span.
  const simple: Service = { ...base, frequencyMinutes: 10, spanStart: '06:00', spanEnd: '23:00' };
  it('a service inside its span runs at its stated headway', () => {
    expect(activeSchedule(simple, at('08:00'), 'weekday')?.headwayMinutes).toBe(10);
  });
  it('a service outside its span runs no vehicles', () => {
    expect(activeSchedule(simple, at('03:00'), 'weekday')).toBeNull();
  });
  it("a span's first minute is already service", () => {
    expect(activeSchedule(simple, at('06:00'), 'weekday')).not.toBeNull();
  });
  it("a span's last minute is already over", () => {
    expect(activeSchedule(simple, at('23:00'), 'weekday')).toBeNull();
  });

  const owl: Service = { ...base, frequencyMinutes: 30, spanStart: '22:00', spanEnd: '02:00' };
  it('a span crossing midnight is still running at 00:30', () => {
    expect(activeSchedule(owl, 30, 'weekday')).not.toBeNull();
  });
  it('a span crossing midnight is not running at midday', () => {
    expect(activeSchedule(owl, at('12:00'), 'weekday')).toBeNull();
  });

  // A detailed schedule supersedes the flat fields, period by period.
  const scheduled: Service = {
    ...base,
    frequencyMinutes: 10,
    spanStart: '06:00',
    spanEnd: '23:00',
    schedule: [
      {
        id: 'p1',
        label: 'Peak',
        days: 'weekday',
        spanStart: '06:00',
        spanEnd: '09:00',
        frequencyMinutes: 5,
      },
      {
        id: 'p2',
        label: 'Midday',
        days: 'weekday',
        spanStart: '09:00',
        spanEnd: '15:00',
        frequencyMinutes: 15,
      },
      {
        id: 'p3',
        label: 'Weekend',
        days: 'weekend',
        spanStart: '08:00',
        spanEnd: '20:00',
        frequencyMinutes: 30,
      },
    ],
  };
  it("a schedule period's headway supersedes the flat frequency", () => {
    expect(activeSchedule(scheduled, at('07:00'), 'weekday')?.headwayMinutes).toBe(5);
  });
  it('the period is named, so the UI can say which one is running', () => {
    expect(activeSchedule(scheduled, at('07:00'), 'weekday')?.label).toBe('Peak');
  });
  it("a period's headway takes over at the minute it starts", () => {
    expect(activeSchedule(scheduled, at('09:00'), 'weekday')?.headwayMinutes).toBe(15);
  });
  it('an hour no period covers runs nothing, even inside the flat span', () => {
    expect(activeSchedule(scheduled, at('16:00'), 'weekday')).toBeNull();
  });
  it("a weekday-only period doesn't run at the weekend", () => {
    expect(activeSchedule(scheduled, at('07:00'), 'weekend')).toBeNull();
  });
  it('a weekend period runs at the weekend', () => {
    expect(activeSchedule(scheduled, at('10:00'), 'weekend')?.headwayMinutes).toBe(30);
  });
  it("a weekend period doesn't run on a weekday", () => {
    expect(activeSchedule(scheduled, at('10:00'), 'weekday')?.label).not.toBe('Weekend');
  });

  const daily: Service = {
    ...base,
    schedule: [
      {
        id: 'd1',
        label: 'All day',
        days: 'daily',
        spanStart: '05:00',
        spanEnd: '01:00',
        frequencyMinutes: 12,
      },
    ],
  };
  it('a daily period runs on weekdays', () => {
    expect(activeSchedule(daily, at('10:00'), 'weekday')?.headwayMinutes).toBe(12);
  });
  it('a daily period runs at the weekend too', () => {
    expect(activeSchedule(daily, at('10:00'), 'weekend')?.headwayMinutes).toBe(12);
  });

  const malformed: Service = {
    ...base,
    schedule: [
      {
        id: 'm1',
        label: 'Broken',
        days: 'daily',
        spanStart: 'nope',
        spanEnd: 'also nope',
        frequencyMinutes: 12,
      },
    ],
  };
  it('a period with an unparseable span is skipped rather than guessed at', () => {
    expect(activeSchedule(malformed, at('10:00'), 'weekday')).toBeNull();
  });

  // Pinning a scenario: show one service configuration whatever the clock says.
  it("a pinned period overrides the clock's own period", () => {
    expect(activeSchedule(scheduled, at('14:00'), 'weekday', 'Peak')?.headwayMinutes).toBe(5);
  });
  it('a pinned period runs at an hour nothing would otherwise run', () => {
    expect(activeSchedule(scheduled, at('03:00'), 'weekday', 'Peak')?.headwayMinutes).toBe(5);
  });
  it('pinning ignores the day of the week too', () => {
    expect(activeSchedule(scheduled, at('14:00'), 'weekend', 'Peak')?.headwayMinutes).toBe(5);
  });
  it('pinning matches a period name case-insensitively', () => {
    expect(activeSchedule(scheduled, at('14:00'), 'weekday', 'peak')?.headwayMinutes).toBe(5);
  });
  it("a service with no period by that name doesn't run in that scenario", () => {
    expect(activeSchedule(scheduled, at('14:00'), 'weekday', 'Owl')).toBeNull();
  });
  it('a service with no detailed schedule runs its flat headway in any scenario', () => {
    expect(activeSchedule(simple, at('03:00'), 'weekday', 'Peak')?.headwayMinutes).toBe(10);
  });

  // The scenarios on offer are derived from the periods themselves.
  it("scenario names are collected from every service's periods", () => {
    const labels = schedulePeriodLabels([scheduled, daily, { ...base, id: 'as2' }]);
    expect(labels).toEqual(['Peak', 'Midday', 'Weekend', 'All day']);
  });
  it('a system with no detailed schedules offers no scenarios', () => {
    expect(schedulePeriodLabels([simple, base]).length).toBe(0);
  });
  it('the same period name on two services is one scenario', () => {
    expect(schedulePeriodLabels([scheduled, { ...scheduled, id: 'as3' }]).length).toBe(3);
  });
});

// Frequencies add, headways don't. This is the number that makes overlapping
// lines worth drawing, and nothing in the editor used to state it.
describe('combined frequency where routes share a stop (core/sim/frequency.ts)', () => {
  it('two ten-minute routes at one stop give a five-minute combined headway', () => {
    expect(combinedHeadwayMinutes([10, 10])).toBe(5);
  });
  it('three ten-minute routes give a three-and-a-third-minute headway', () => {
    const combined = mustFind(combinedHeadwayMinutes([10, 10, 10]), 'a combined headway');
    expect(Math.abs(combined - 10 / 3)).toBeLessThan(1e-9);
  });
  it("a stop served by one route reports that route's own headway", () => {
    expect(combinedHeadwayMinutes([12])).toBe(12);
  });
  it('an infrequent route barely improves a frequent one', () => {
    const combined = mustFind(combinedHeadwayMinutes([10, 60]), 'a combined headway');
    expect(Math.abs(combined - 60 / 7)).toBeLessThan(1e-9);
  });
  it('combining is never worse than the best single route', () => {
    expect(mustFind(combinedHeadwayMinutes([10, 60]), 'a combined headway')).toBeLessThanOrEqual(
      10,
    );
  });
  it('a stop with no frequencies reports nothing rather than infinity', () => {
    expect(combinedHeadwayMinutes([])).toBeNull();
  });
  it('a nonsense headway is ignored rather than dividing by zero', () => {
    expect(combinedHeadwayMinutes([0, 10])).toBe(10);
  });

  it('a ten-minute headway is six vehicles an hour', () => {
    expect(vehiclesPerHour([10])).toBe(6);
  });
  it('vehicles per hour add across routes', () => {
    expect(vehiclesPerHour([10, 15])).toBe(10);
  });
  it('turning up at random means waiting half the headway', () => {
    expect(typicalWaitMinutes(10)).toBe(5);
  });

  // servicesAtStop: the same proximity rule the inspector's "Served by"
  // list uses, moved into core so it's testable and stated once.
  describe('servicesAtStop', () => {
    const road = (id: string, pts: LngLat[]): Way => ({
      id,
      typeId: 'road',
      points: pts,
      geometry: 'straight',
      grade: 'atGrade',
      profile: defaultProfileFor('road'),
    });
    const way = road('fq-near', [
      [-115.24, 36.1],
      [-115.17, 36.1],
    ]);
    const otherWay = road('fq-far', [
      [-115.24, 36.5],
      [-115.17, 36.5],
    ]);
    const sys = createEmptySystem();
    sys.ways = [way, otherWay];
    sys.services = [
      {
        id: 'sv-on',
        name: 'On it',
        modeId: 'bus',
        path: { id: 'pa', sections: oneSection(legsOf(way.id)) },
      },
      {
        id: 'sv-off',
        name: 'Miles away',
        modeId: 'bus',
        path: { id: 'pb', sections: oneSection(legsOf(otherWay.id)) },
      },
    ];

    it('a service running past a stop serves it', () => {
      const stop: Stop = { id: 'st-here', coord: [-115.2, 36.1], anchors: [] };
      const here = servicesAtStop(sys.ways, sys.services, stop);
      expect(here.length).toBe(1);
      expect(here[0].id).toBe('sv-on');
    });
    it('a stop nowhere near any line is served by nothing', () => {
      const nowhere = servicesAtStop(sys.ways, sys.services, {
        id: 'st-far',
        coord: [-115.2, 36.3],
        anchors: [],
      });
      expect(nowhere.length).toBe(0);
    });
  });
});
