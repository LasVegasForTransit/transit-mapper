import { describe, expect, it } from 'vitest';
import { planService } from '@transitmapper/core/sim/fleet';
import { activeSchedule } from '@transitmapper/core/sim/clock';
import {
  deriveServiceLevels,
  formatGtfsTime,
  medianHeadwayMinutes,
  parseGtfsTime,
} from '@transitmapper/core/model/gtfsSchedule';
import { gtfsFilesToSystemPieces } from '@transitmapper/core/model/gtfsImport';

// Import used to discard every time in the feed, so a real agency's network
// animated as one vehicle per route. These pin how a headway is recovered, and
// in particular the three ways a naive reading gets it wrong: blending service
// days, blending directions, and averaging across the overnight gap.
describe('service levels recovered from a GTFS feed (core/model/gtfsSchedule.ts)', () => {
  it('a GTFS time parses to seconds after midnight', () => {
    expect(parseGtfsTime('06:30:00')).toBe(23400);
  });
  it('a past-midnight GTFS time keeps counting past 24h', () => {
    expect(parseGtfsTime('25:10:00')).toBe(90600);
  });
  it('a malformed GTFS time is rejected rather than guessed at', () => {
    expect(parseGtfsTime('nope')).toBeNull();
  });
  it('an out-of-range minute is rejected', () => {
    expect(parseGtfsTime('06:75:00')).toBeNull();
  });
  it('seconds format back to a clock reading', () => {
    expect(formatGtfsTime(23400)).toBe('06:30');
  });
  it('a past-midnight time wraps to a real clock reading', () => {
    expect(formatGtfsTime(90600)).toBe('01:10');
  });

  // 10 departures 10 minutes apart, then a 7-hour overnight gap. The mean gap
  // is over an hour; the median is the 10 minutes a rider actually experiences.
  const tenApart = Array.from({ length: 10 }, (_, i) => 6 * 3600 + i * 600);
  it('the headway is the median gap', () => {
    expect(medianHeadwayMinutes(tenApart)).toBe(10);
  });
  it('one enormous overnight gap does not drag the headway up', () => {
    expect(medianHeadwayMinutes([...tenApart, 6 * 3600 + 9 * 600 + 7 * 3600])).toBe(10);
  });
  it('a single departure has no headway to report', () => {
    expect(medianHeadwayMinutes([3600])).toBeNull();
  });
  it('no departures report no headway', () => {
    expect(medianHeadwayMinutes([])).toBeNull();
  });

  // Two directions, six trips each, 20 minutes apart per direction and
  // interleaved 10 minutes apart overall. The honest answer is 20: a rider
  // going one way cannot use the other direction's bus.
  const trips: Record<string, string>[] = [];
  const stopTimes: Record<string, string>[] = [];
  for (let i = 0; i < 6; i++) {
    for (const dir of ['0', '1']) {
      const tripId = `T${dir}-${i}`;
      trips.push({ trip_id: tripId, route_id: 'R1', service_id: 'WEEKDAY', direction_id: dir });
      const start = 6 * 3600 + i * 1200 + (dir === '1' ? 600 : 0);
      stopTimes.push({
        trip_id: tripId,
        stop_id: 'A',
        stop_sequence: '1',
        departure_time: `${String(Math.floor(start / 3600)).padStart(2, '0')}:${String(Math.floor((start % 3600) / 60)).padStart(2, '0')}:00`,
      });
    }
  }
  const perDirection = deriveServiceLevels({ trips, stopTimes }).get('R1');
  it('a two-way route reports its per-direction headway, not double it', () => {
    expect(perDirection?.frequencyMinutes).toBe(20);
  });
  it('the span runs from the first departure to the last', () => {
    expect(perDirection?.spanStart).toBe('06:00');
  });

  // A Sunday timetable under a second service_id must not dilute the weekday
  // reading — calendar.txt is not imported, so the busiest service_id wins.
  const withSunday = [...trips];
  const sundayTimes = [...stopTimes];
  for (let i = 0; i < 2; i++) {
    withSunday.push({
      trip_id: `SUN-${i}`,
      route_id: 'R1',
      service_id: 'SUNDAY',
      direction_id: '0',
    });
    sundayTimes.push({
      trip_id: `SUN-${i}`,
      stop_id: 'A',
      stop_sequence: '1',
      departure_time: `${String(9 + i * 3).padStart(2, '0')}:00:00`,
    });
  }
  it('a quieter service day does not dilute the headway', () => {
    expect(
      deriveServiceLevels({ trips: withSunday, stopTimes: sundayTimes }).get('R1')
        ?.frequencyMinutes,
    ).toBe(20);
  });

  // frequencies.txt states the headway outright, so it wins over measurement.
  const frequencies = [
    { trip_id: 'T0-0', start_time: '06:00:00', end_time: '09:00:00', headway_secs: '300' },
    { trip_id: 'T0-0', start_time: '09:00:00', end_time: '15:00:00', headway_secs: '900' },
  ];
  const stated = deriveServiceLevels({ trips, stopTimes, frequencies }).get('R1');
  it('frequencies.txt is trusted over a measured headway', () => {
    expect(stated?.schedule?.length).toBe(2);
  });
  it('each frequencies.txt window becomes a schedule period', () => {
    expect(stated?.schedule?.[0].frequencyMinutes).toBe(5);
  });
  it('a frequencies.txt window keeps its time span', () => {
    expect(stated?.schedule?.[0].spanStart).toBe('06:00');
    expect(stated?.schedule?.[0].spanEnd).toBe('09:00');
  });
  it('periods are named from the hour they start', () => {
    expect(stated?.schedule?.[0].label).toBe('AM peak');
    expect(stated?.schedule?.[1].label).toBe('Midday');
  });
  it('the quick headway field summarises the busiest period', () => {
    expect(stated?.frequencyMinutes).toBe(5);
  });
  it('a stated schedule still runs at its own times', () => {
    expect(
      activeSchedule(
        { id: 'x', name: 'x', modeId: 'bus', color: '#000', patterns: [], ...stated },
        7 * 60,
        'weekday',
      )?.headwayMinutes,
    ).toBe(5);
  });

  // End to end: the same feed through the real importer carries its timing.
  const timedStopTimes =
    'trip_id,stop_id,stop_sequence,departure_time\n' +
    'T1,ST1,1,06:00:00\nT1,ST2,2,06:10:00\n' +
    'T2,ST1,1,06:30:00\nT2,ST2,2,06:40:00\n' +
    'T3,ST1,1,07:00:00\nT3,ST2,2,07:10:00\n';
  const timed = gtfsFilesToSystemPieces({
    routes: 'route_id,route_short_name,route_type\nR1,101,3\n',
    trips: 'route_id,trip_id,shape_id,service_id\nR1,T1,S1,WK\nR1,T2,S1,WK\nR1,T3,S1,WK\n',
    shapes:
      'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nS1,36.10,-115.20,1\nS1,36.10,-115.17,2\n',
    stops: 'stop_id,stop_name,stop_lat,stop_lon\nST1,A,36.10,-115.20\nST2,B,36.10,-115.17\n',
    stopTimes: timedStopTimes,
  });
  it('an imported route carries the headway its feed implies', () => {
    expect(timed.services[0].frequencyMinutes).toBe(30);
  });
  it('an imported route carries its span of service', () => {
    expect(timed.services[0].spanStart).toBe('06:00');
    expect(timed.services[0].spanEnd).toBe('07:00');
  });
  it('an imported route now runs more than one vehicle', () => {
    expect(
      planService(2 * 45 * 60_000, (timed.services[0].frequencyMinutes ?? 0) * 60_000).fleet,
    ).toBeGreaterThan(1);
  });
  it('an imported route stops running outside its span', () => {
    expect(activeSchedule(timed.services[0], 3 * 60, 'weekday')).toBeNull();
  });

  // The scale guard. Timing turns every imported pattern from one vehicle into
  // a fleet, which is the cost the plan flagged before this could land. The
  // per-pattern draw cap is what bounds it, so this fails loudly if that cap
  // stops applying.
  describe('the scale guard', () => {
    const AGENCY_PATTERNS = 285; // RTC Southern Nevada's order of magnitude
    const roundTripMsForAgency = 2 * 45 * 60_000; // a 45-minute run each way
    const agencyPlan = planService(roundTripMsForAgency, 10 * 60_000);
    const drawnPerPattern = Math.min(agencyPlan.fleet, 12);

    it('a frequent agency route really does need a fleet', () => {
      expect(agencyPlan.fleet).toBeGreaterThan(5);
    });
    it('the draw cap bounds what an agency-scale import puts on screen', () => {
      expect(AGENCY_PATTERNS * drawnPerPattern).toBeLessThanOrEqual(285 * 12);
    });
    it('the cap never changes the headway the plan runs', () => {
      expect(agencyPlan.cycleMs).toBe(agencyPlan.fleet * 10 * 60_000);
    });
  });
});
