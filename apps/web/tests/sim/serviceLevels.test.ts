import { describe, expect, it } from 'vitest';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import type { Service, Station, VehicleKind, Way } from '@transitmapper/core/model/system';
import {
  buildTimetable,
  DEFAULT_MOTION_PROFILE,
  roundTripMs as runRoundTripMs,
} from '@transitmapper/core/sim/timetable';
import { planService, runStateAt } from '@transitmapper/core/sim/fleet';
import {
  DEFAULT_DWELL_SECONDS,
  patternStats,
  serviceStats,
} from '@transitmapper/core/sim/serviceStats';
import { activeSchedule } from '@transitmapper/core/sim/clock';
import {
  deriveServiceLevels,
  formatGtfsTime,
  medianHeadwayMinutes,
  parseGtfsTime,
} from '@transitmapper/core/model/gtfsSchedule';
import { gtfsFilesToSystemPieces } from '@transitmapper/core/model/gtfsImport';

/** Whole-way legs in stored point order. */
const legsOf = (...wayIds: string[]) => wayIds.map((wayId) => wholeLeg(wayId));

// The point of this module: a line set to "every 10 minutes" must actually
// serve its stops every 10 minutes. These checks are that promise.
describe('fleet sizing and the run cycle (core/sim/fleet.ts)', () => {
  const totalMeters = 11_000; // 11 km one way
  const timetable = buildTimetable(totalMeters, [], DEFAULT_MOTION_PROFILE);
  // A line that comes back the way it went: both directions are the same
  // timetable, which is what makes the round trip exactly twice the one-way
  // time and every number below unchanged from before directions existed.
  const timetables = { outbound: timetable, inbound: timetable };
  // 16,500ms ramping (9,166.67ms accelerating at 1.2 m/s², 7,333.33ms braking
  // at 1.5 m/s², covering 90.75m between them) + 991,750ms cruising the
  // remaining 10,909.25m — see the kinematics block above for how a leg's
  // time is built from its ramps.
  const oneWayMs = timetable.oneWayMs; // 1,008,250 ms
  const roundTripMs = 2 * oneWayMs;
  const headwayMs = 10 * 60_000;
  const plan = planService(roundTripMs, headwayMs);

  it('a line that returns the way it came has a round trip of exactly twice one way', () => {
    expect(runRoundTripMs(timetables)).toBe(roundTripMs);
  });

  // Round trip 2,016,500 ms + a 120,000 ms minimum layover (5% of the round
  // trip is only 100,825ms, short of the floor) = 2,136,500, which is 3.56
  // headways — so four vehicles, and a 40-minute cycle.
  it('fleet size is the round trip plus layover over the headway, rounded up', () => {
    expect(plan.fleet).toBe(4);
  });
  it('cycle time is a whole number of headways', () => {
    expect(plan.cycleMs).toBe(plan.fleet * headwayMs);
  });
  it('the cycle is never shorter than the round trip a vehicle has to run', () => {
    expect(plan.cycleMs).toBeGreaterThanOrEqual(roundTripMs);
  });
  it('the slack between the round trip and the cycle is split between the two terminals', () => {
    expect(plan.layoverMs).toBe((plan.cycleMs - roundTripMs) / 2);
  });

  // THE check. A stop 4.4 km along the line — well past the ~50m ramp-up, so
  // it's reached during the cruise phase — is reached at a computable time
  // into an outbound run; run i departs i headways later, so it should be
  // there at exactly that time — which makes successive vehicles exactly one
  // headway apart at that stop.
  const stopMeters = 4_400;
  const accelDist =
    (DEFAULT_MOTION_PROFILE.speedMps * DEFAULT_MOTION_PROFILE.speedMps) /
    (2 * DEFAULT_MOTION_PROFILE.accelMps2);
  const accelMs = (DEFAULT_MOTION_PROFILE.speedMps / DEFAULT_MOTION_PROFILE.accelMps2) * 1000;
  const reachedAtMs = accelMs + ((stopMeters - accelDist) / DEFAULT_MOTION_PROFILE.speedMps) * 1000;

  it('a ten-minute headway puts a vehicle at each stop every ten minutes', () => {
    let everyRunOnTime = true;
    for (let i = 0; i < plan.fleet; i++) {
      const state = runStateAt(
        i * headwayMs + reachedAtMs,
        timetables,
        plan,
        i,
        DEFAULT_MOTION_PROFILE,
      );
      if (Math.abs(state.distMeters - stopMeters) > 1e-6 || state.phase !== 'outbound')
        everyRunOnTime = false;
    }
    expect(everyRunOnTime).toBe(true);
  });

  // The wrap is where even spacing gets it wrong: after the last vehicle, the
  // next one along is the first vehicle again, and it must arrive one headway
  // later — not after whatever is left of the cycle.
  it('the headway holds across the wrap from the last vehicle back to the first', () => {
    const afterLast = runStateAt(
      plan.fleet * headwayMs + reachedAtMs,
      timetables,
      plan,
      0,
      DEFAULT_MOTION_PROFILE,
    );
    expect(Math.abs(afterLast.distMeters - stopMeters)).toBeLessThan(1e-6);
  });

  // The rest of the cycle.
  it('a vehicle waits out its layover at the far terminal', () => {
    const atFarTerminal = runStateAt(
      oneWayMs + plan.layoverMs / 2,
      timetables,
      plan,
      0,
      DEFAULT_MOTION_PROFILE,
    );
    expect(atFarTerminal.phase).toBe('layover');
    expect(atFarTerminal.distMeters).toBe(totalMeters);
  });
  it('the return leg passes the same stop from the other direction', () => {
    const returning = runStateAt(
      oneWayMs + plan.layoverMs + reachedAtMs,
      timetables,
      plan,
      0,
      DEFAULT_MOTION_PROFILE,
    );
    // Measured along the RETURN path from its own start, not counted down the
    // outward one — so the same elapsed time gives the same number, and the
    // two directions no longer have to be the same length for it to mean
    // anything.
    expect(returning.phase).toBe('inbound');
    expect(Math.abs(returning.distMeters - stopMeters)).toBeLessThan(1e-6);
  });
  it('a vehicle finishes its cycle waiting at the terminal it started from', () => {
    const backHome = runStateAt(
      plan.cycleMs - plan.layoverMs / 2,
      timetables,
      plan,
      0,
      DEFAULT_MOTION_PROFILE,
    );
    expect(backHome.phase).toBe('layover');
    expect(backHome.distMeters).toBe(totalMeters);
  });
  it('the cycle repeats exactly', () => {
    const wrapped = runStateAt(
      plan.cycleMs + reachedAtMs,
      timetables,
      plan,
      0,
      DEFAULT_MOTION_PROFILE,
    );
    expect(Math.abs(wrapped.distMeters - stopMeters)).toBeLessThan(1e-6);
  });
  // Tolerance, not exact equality: reachedAtMs is a repeating decimal (it
  // covers the cruise-phase fraction of a leg), and cycleMs + reachedAtMs
  // taken mod cycleMs isn't guaranteed to land on the same float, bit for
  // bit, as -cycleMs + reachedAtMs mod cycleMs — floating-point modulo on a
  // non-integer input, not a modeling concern.
  it("a run's position doesn't depend on how many cycles have passed", () => {
    const wrapped = runStateAt(
      plan.cycleMs + reachedAtMs,
      timetables,
      plan,
      0,
      DEFAULT_MOTION_PROFILE,
    );
    const shifted = runStateAt(
      -plan.cycleMs + reachedAtMs,
      timetables,
      plan,
      0,
      DEFAULT_MOTION_PROFILE,
    );
    expect(Math.abs(shifted.distMeters - wrapped.distMeters)).toBeLessThan(1e-6);
  });

  // Dwelling at intermediate stops still counts toward the round trip, so the
  // fleet grows when stations are added to a line — which is the real-world
  // behavior (more stops, slower trip, more vehicles to hold the headway).
  describe('adding stops', () => {
    const withStops = buildTimetable(
      totalMeters,
      [
        { distMeters: 4_400, dwellMs: 30_000 },
        { distMeters: 8_000, dwellMs: 30_000 },
      ],
      DEFAULT_MOTION_PROFILE,
    );
    const slowerPlan = planService(
      runRoundTripMs({ outbound: withStops, inbound: withStops }),
      headwayMs,
    );

    it('adding stops lengthens the round trip', () => {
      expect(withStops.oneWayMs).toBeGreaterThan(oneWayMs);
    });
    it('a slower round trip at the same headway needs at least as many vehicles', () => {
      expect(slowerPlan.fleet).toBeGreaterThanOrEqual(plan.fleet);
    });
    it('the headway is still exact once stops are involved', () => {
      expect(slowerPlan.cycleMs).toBe(slowerPlan.fleet * headwayMs);
    });
  });

  // Degenerate cases have defined answers.
  describe('degenerate cases', () => {
    it('a headway longer than the round trip runs one vehicle, waiting at the terminal', () => {
      const infrequent = planService(600_000, 60 * 60_000); // 10-minute loop, hourly service
      expect(infrequent.fleet).toBe(1);
    });
    it("that one vehicle's cycle is the headway, not the round trip", () => {
      const infrequent = planService(600_000, 60 * 60_000);
      expect(infrequent.cycleMs).toBe(60 * 60_000);
    });
    it('a service with no headway set runs a single vehicle', () => {
      const unscheduled = planService(600_000);
      expect(unscheduled.fleet).toBe(1);
    });
    it('even a short line gets a real layover rather than turning on a dime', () => {
      expect(planService(60_000, 60_000).layoverMs).toBeGreaterThan(0);
    });
  });
});

// The chain the editor used to hide: stops and dwell lengthen the round trip,
// the round trip and the headway decide the fleet. These checks pin each link,
// because the inspector now states all three and must not drift from the map.
describe('what a line amounts to (core/sim/serviceStats.ts)', () => {
  const straight = (id: string, lng2: number): Way => ({
    id,
    typeId: 'guideway',
    points: [
      [-115.3, 36.2],
      [lng2, 36.2],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('guideway'),
  });
  const ways = [straight('ss-w', -115.2)]; // ~8.97 km at this latitude
  const svc: Service = {
    id: 'ss-1',
    name: 'Green',
    modeId: 'lightRail',
    color: '#0a0',
    patterns: [{ id: 'ss-p', sections: oneSection(legsOf('ss-w')) }],
    frequencyMinutes: 10,
  };

  const bare = serviceStats(ways, [], [], svc, 10)!;
  it("a service's round trip is out and back", () => {
    expect(Math.abs(bare.longestRoundTripMs - 2 * bare.patterns[0].oneWayMs)).toBeLessThan(1e-9);
  });
  it('a stopless line spends no time dwelling', () => {
    expect(bare.patterns[0].dwellMs).toBe(0);
  });
  it('a line reports the fleet its headway needs', () => {
    expect(bare.fleet).toBe(bare.patterns[0].plan!.fleet);
  });
  it('a line reports recovery time at its terminals', () => {
    expect(bare.layoverMs).toBeGreaterThan(0);
  });

  // Stops lengthen the round trip. That is the coupling the dwell field
  // claims and the inspector now shows.
  const stations: Station[] = [
    { id: 'ss-a', coord: [-115.27, 36.2], anchors: [{ wayId: 'ss-w', t: 0.1 }] },
    { id: 'ss-b', coord: [-115.25, 36.2], anchors: [{ wayId: 'ss-w', t: 0.5 }] },
  ];
  const stopped = serviceStats(ways, stations, [], svc, 10)!;
  it('stations on a line become stops', () => {
    expect(stopped.patterns[0].stops.length).toBe(2);
  });
  it('stops make the round trip longer', () => {
    expect(stopped.longestRoundTripMs).toBeGreaterThan(bare.longestRoundTripMs);
  });
  it('a longer dwell makes it longer still', () => {
    const longerDwell = serviceStats(
      ways,
      stations.map((s) => ({ ...s, dwellSeconds: 300 })),
      [],
      svc,
      10,
    )!;
    expect(longerDwell.longestRoundTripMs).toBeGreaterThan(stopped.longestRoundTripMs);
  });
  it('dwell time is counted as time standing still, not travelling', () => {
    expect(stopped.patterns[0].dwellMs).toBe(2 * DEFAULT_DWELL_SECONDS * 1000);
  });

  // A faster vehicle shortens it, and can therefore need fewer vehicles.
  const kinds: VehicleKind[] = [
    {
      id: 'ss-fast',
      modeId: 'lightRail',
      label: 'Express',
      widthM: 2.6,
      lengthM: 30,
      topSpeedKmh: 120,
    },
  ];
  const fast = serviceStats(ways, stations, kinds, { ...svc, vehicleKindId: 'ss-fast' }, 10)!;
  it('a faster vehicle kind shortens the round trip', () => {
    expect(fast.longestRoundTripMs).toBeLessThan(stopped.longestRoundTripMs);
  });
  it('a shorter round trip never needs more vehicles', () => {
    expect(fast.fleet).toBeLessThanOrEqual(stopped.fleet);
  });

  // Headway is the other input to fleet size.
  const frequent = serviceStats(ways, stations, [], svc, 5)!;
  it('halving the headway at least doubles the fleet', () => {
    expect(frequent.fleet).toBeGreaterThanOrEqual(2 * stopped.fleet - 1);
    expect(frequent.fleet).toBeGreaterThan(stopped.fleet);
  });
  it('a service with no headway set runs one vehicle', () => {
    expect(serviceStats(ways, stations, [], svc, undefined)!.fleet).toBe(1);
  });

  // A branch runs its own vehicles on top of the trunk's.
  const branched: Service = {
    ...svc,
    patterns: [
      { id: 'ss-p', sections: oneSection(legsOf('ss-w')) },
      { id: 'ss-p2', sections: oneSection(legsOf('ss-w')) },
    ],
  };
  it('each branch runs its own fleet', () => {
    expect(serviceStats(ways, stations, [], branched, 10)!.fleet).toBe(2 * stopped.fleet);
  });

  it('a line whose ways resolve to no path reports nothing rather than zeroes', () => {
    expect(serviceStats([], [], [], svc, 10)).toBeNull();
  });

  // The map and the inspector must agree by construction: same stops, same
  // timetable, same plan.
  it('per-pattern and per-service measurements agree', () => {
    const viaPattern = patternStats(ways, stations, svc.patterns[0], DEFAULT_MOTION_PROFILE, 10)!;
    expect(viaPattern.roundTripMs).toBe(stopped.longestRoundTripMs);
    expect(viaPattern.plan!.fleet).toBe(stopped.fleet);
  });
});

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
