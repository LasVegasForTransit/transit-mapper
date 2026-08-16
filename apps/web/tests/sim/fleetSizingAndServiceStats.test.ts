import { describe, expect, it } from 'vitest';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import type { Service, Stop, VehicleKind, Way } from '@transitmapper/core/model/system';
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

/** Whole-way legs in stored point order. */
const legsOf = (...wayIds: string[]) => wayIds.map((wayId) => wholeLeg(wayId));

function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

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
    path: { id: 'ss-p', sections: oneSection(legsOf('ss-w')) },
    frequencyMinutes: 10,
  };

  const bare = mustFind(serviceStats(ways, [], [], svc, 10), 'service stats');
  it("a service's round trip is out and back", () => {
    expect(Math.abs(bare.roundTripMs - 2 * bare.path.oneWayMs)).toBeLessThan(1e-9);
  });
  it('a stopless line spends no time dwelling', () => {
    expect(bare.path.dwellMs).toBe(0);
  });
  it('a line reports the fleet its headway needs', () => {
    expect(bare.fleet).toBe(mustFind(bare.path.plan, 'plan').fleet);
  });
  it('a line reports recovery time at its terminals', () => {
    expect(bare.layoverMs).toBeGreaterThan(0);
  });

  // Stops lengthen the round trip. That is the coupling the dwell field
  // claims and the inspector now shows.
  const stops: Stop[] = [
    { id: 'ss-a', coord: [-115.27, 36.2], anchors: [{ wayId: 'ss-w', t: 0.1 }] },
    { id: 'ss-b', coord: [-115.25, 36.2], anchors: [{ wayId: 'ss-w', t: 0.5 }] },
  ];
  const stopped = mustFind(serviceStats(ways, stops, [], svc, 10), 'service stats');
  it('stops on a line become stops', () => {
    expect(stopped.path.stops.length).toBe(2);
  });
  it('stops make the round trip longer', () => {
    expect(stopped.roundTripMs).toBeGreaterThan(bare.roundTripMs);
  });
  it('a longer dwell makes it longer still', () => {
    const longerDwell = mustFind(
      serviceStats(
        ways,
        stops.map((s) => ({ ...s, dwellSeconds: 300 })),
        [],
        svc,
        10,
      ),
      'service stats',
    );
    expect(longerDwell.roundTripMs).toBeGreaterThan(stopped.roundTripMs);
  });
  it('dwell time is counted as time standing still, not travelling', () => {
    expect(stopped.path.dwellMs).toBe(2 * DEFAULT_DWELL_SECONDS * 1000);
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
  const fast = mustFind(
    serviceStats(ways, stops, kinds, { ...svc, vehicleKindId: 'ss-fast' }, 10),
    'service stats',
  );
  it('a faster vehicle kind shortens the round trip', () => {
    expect(fast.roundTripMs).toBeLessThan(stopped.roundTripMs);
  });
  it('a shorter round trip never needs more vehicles', () => {
    expect(fast.fleet).toBeLessThanOrEqual(stopped.fleet);
  });

  // Headway is the other input to fleet size.
  const frequent = mustFind(serviceStats(ways, stops, [], svc, 5), 'service stats');
  it('halving the headway at least doubles the fleet', () => {
    expect(frequent.fleet).toBeGreaterThanOrEqual(2 * stopped.fleet - 1);
    expect(frequent.fleet).toBeGreaterThan(stopped.fleet);
  });
  it('a service with no headway set runs one vehicle', () => {
    expect(mustFind(serviceStats(ways, stops, [], svc, undefined), 'service stats').fleet).toBe(1);
  });

  // A branch runs its own vehicles on top of the trunk's — now a sibling
  // Service under the same Line rather than a second pattern on one Service.
  const branched: Service = {
    ...svc,
    id: 'ss-2',
    path: { id: 'ss-p2', sections: oneSection(legsOf('ss-w')) },
  };
  it('each branch runs its own fleet', () => {
    expect(
      stopped.fleet + mustFind(serviceStats(ways, stops, [], branched, 10), 'service stats').fleet,
    ).toBe(2 * stopped.fleet);
  });

  it('a line whose ways resolve to no path reports nothing rather than zeroes', () => {
    expect(serviceStats([], [], [], svc, 10)).toBeNull();
  });

  // The map and the inspector must agree by construction: same stops, same
  // timetable, same plan.
  it('per-pattern and per-service measurements agree', () => {
    const viaPattern = mustFind(
      patternStats(ways, stops, svc.path, DEFAULT_MOTION_PROFILE, 10),
      'pattern stats',
    );
    expect(viaPattern.roundTripMs).toBe(stopped.roundTripMs);
    expect(mustFind(viaPattern.plan, 'plan').fleet).toBe(stopped.fleet);
  });
});
