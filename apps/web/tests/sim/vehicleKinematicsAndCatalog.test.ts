import { describe, expect, it } from 'vitest';
import { vehicleFootprint } from '@transitmapper/core/model/catalog';
import { haversineMeters, oneSection, stretchLeg, wholeLeg } from '@transitmapper/core/model/geo';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { LngLat, PatternLeg, Service, TransitSystem } from '@transitmapper/core/model/system';
import {
  DEFAULT_MOTION_PROFILE,
  buildTimetable,
  metersAtElapsed,
  type VehicleMotionProfile,
} from '@transitmapper/core/sim/timetable';
import { dwellStopsForPattern, effectiveVehicleKind } from '@transitmapper/core/sim/serviceStats';

/** Whole-way legs in stored point order — the shape a hand-built fixture wants
 *  when direction and extent aren't what it's testing. */
const legsOf = (...wayIds: string[]): PatternLeg[] => wayIds.map((wayId) => wholeLeg(wayId));

describe('dwell-time and kinematic timetable math (vehicles.ts) — the vehicle animation walks this instead of a plain distance/speed triangle wave, so a vehicle actually pauses at each station instead of gliding through it, and ramps up/down at the ends of each leg instead of snapping straight to top speed', () => {
  // Round numbers chosen so accel/cruise/decel boundaries fall on clean
  // times and distances: top speed 10 m/s, 2 m/s² accelerating (5000ms/25m
  // to reach it), 5 m/s² braking (2000ms/10m to shed it).
  const profile: VehicleMotionProfile = { speedMps: 10, accelMps2: 2, decelMps2: 5 };
  const totalMeters = 1000;

  describe('no stops: one leg, long enough to reach cruise speed', () => {
    // 25m accelerating + 965m cruising + 10m braking.
    const noStops = buildTimetable(totalMeters, [], profile);

    it('a leg long enough to cruise still ends exactly on distance', () => {
      expect(noStops.oneWayMs).toBe(103500);
    });

    it('still accelerating partway through the ramp-up', () => {
      expect(metersAtElapsed(noStops, 2500, profile)).toBe(6.25);
    });

    it('reaches top speed exactly where the accelerating distance says it should', () => {
      expect(metersAtElapsed(noStops, 5000, profile)).toBe(25);
    });

    it('cruising at top speed covers ground linearly', () => {
      expect(metersAtElapsed(noStops, 55000, profile)).toBe(525);
    });

    it('braking for the final stop, one second out', () => {
      expect(metersAtElapsed(noStops, 102500, profile)).toBe(997.5);
    });

    it("the full one-way time reaches the path's end, at rest", () => {
      expect(metersAtElapsed(noStops, 103500, profile)).toBe(totalMeters);
    });
  });

  describe('one stop halfway (500m in), dwelling 20s', () => {
    // Two identical 500m legs either side of it, each 53500ms (5000
    // accelerating + 46500 cruising + 2000 braking).
    const oneStop = buildTimetable(totalMeters, [{ distMeters: 500, dwellMs: 20000 }], profile);

    it('the dwell adds on top of travel time for both legs', () => {
      expect(oneStop.oneWayMs).toBe(127000);
    });

    it('still approaching the stop reads as mid-brake', () => {
      expect(metersAtElapsed(oneStop, 52500, profile)).toBe(497.5);
    });

    it('mid-dwell holds position at the stop', () => {
      expect(metersAtElapsed(oneStop, 63500, profile)).toBe(500);
    });

    it('travel resumes after the dwell ends, accelerating from rest again', () => {
      expect(metersAtElapsed(oneStop, 76000, profile)).toBe(506.25);
    });

    it("the full one-way time reaches the path's end", () => {
      expect(metersAtElapsed(oneStop, oneStop.oneWayMs, profile)).toBe(totalMeters);
    });
  });

  describe('a leg too short to ever reach top speed', () => {
    // The case this whole model exists for: closely-spaced stops where a
    // vehicle used to snap straight to its rated top speed. Symmetric
    // 2 m/s² both ways over an 8m leg peaks at just 4 m/s, a fraction of
    // this profile's 10 m/s top speed.
    const shortHopProfile: VehicleMotionProfile = { speedMps: 10, accelMps2: 2, decelMps2: 2 };
    const shortHop = buildTimetable(8, [], shortHopProfile);

    it('a leg too short to reach top speed still completes', () => {
      expect(shortHop.oneWayMs).toBe(4000);
    });

    it("naive constant-top-speed timing would have already arrived — the fix means it hasn't", () => {
      expect(metersAtElapsed(shortHop, 800, shortHopProfile)).toBeLessThan(8);
    });

    it('the peak of a too-short leg sits at its midpoint, by symmetry', () => {
      expect(metersAtElapsed(shortHop, 2000, shortHopProfile)).toBe(4);
    });
  });

  describe('a timetable BUILT at a custom profile must be WALKED at that same profile', () => {
    // vehicles.ts used to build with the vehicle kind's speed but integrate
    // at the module default, so a fast kind ran out of path partway through
    // its leg and sat clamped at the terminal, and a slow one never arrived
    // at all.
    const fastProfile: VehicleMotionProfile = { speedMps: 20, accelMps2: 2, decelMps2: 5 };
    const oneStop = buildTimetable(totalMeters, [{ distMeters: 500, dwellMs: 20000 }], profile);
    const fast = buildTimetable(totalMeters, [{ distMeters: 500, dwellMs: 20000 }], fastProfile);

    it('a faster vehicle kind covers the same path in less time', () => {
      expect(fast.oneWayMs).toBeLessThan(oneStop.oneWayMs);
    });

    it('a faster vehicle kind covers more ground in the same elapsed time', () => {
      expect(metersAtElapsed(fast, 10000, fastProfile)).toBe(100);
    });

    it("walking a timetable at the profile it was built with lands exactly on the path's end", () => {
      expect(metersAtElapsed(fast, fast.oneWayMs, fastProfile)).toBe(totalMeters);
    });
  });
});

describe('vehicle catalogs: effectiveVehicleKind resolution', () => {
  const busService: Service = {
    id: 'evk-bus',
    name: 'Bus',
    modeId: 'bus',
    path: { id: 'evk-bus', sections: [] },
  };
  const sysNoKinds: TransitSystem = { ...createEmptySystem(), vehicleKinds: [] };

  it("an unassigned service resolves to its mode's plain default size", () => {
    const unassigned = effectiveVehicleKind(sysNoKinds.vehicleKinds, busService);
    const busDefault = vehicleFootprint('bus');
    expect(unassigned.widthM).toBe(busDefault.widthM);
    expect(unassigned.lengthM).toBe(busDefault.lengthM);
  });

  it("an unassigned service resolves to the app's default motion profile", () => {
    const unassigned = effectiveVehicleKind(sysNoKinds.vehicleKinds, busService);
    expect(unassigned.profile.speedMps).toBe(DEFAULT_MOTION_PROFILE.speedMps);
    expect(unassigned.profile.accelMps2).toBe(DEFAULT_MOTION_PROFILE.accelMps2);
    expect(unassigned.profile.decelMps2).toBe(DEFAULT_MOTION_PROFILE.decelMps2);
  });

  describe('an assigned service', () => {
    const sysWithKind: TransitSystem = {
      ...sysNoKinds,
      vehicleKinds: [
        {
          id: 'evk1',
          modeId: 'bus',
          label: 'Articulated',
          widthM: 2.6,
          lengthM: 18,
          topSpeedKmh: 72,
          accelMps2: 0.9,
          decelMps2: 2.1,
        },
      ],
    };
    const assigned = effectiveVehicleKind(sysWithKind.vehicleKinds, {
      ...busService,
      vehicleKindId: 'evk1',
    });

    it("an assigned service uses its vehicle kind's own dimensions", () => {
      expect(assigned.widthM).toBe(2.6);
      expect(assigned.lengthM).toBe(18);
    });

    it("an assigned service's top speed converts km/h to m/s", () => {
      expect(Math.abs(assigned.profile.speedMps - 20)).toBeLessThan(1e-9);
    });

    it("an assigned service uses its vehicle kind's own acceleration and deceleration", () => {
      expect(assigned.profile.accelMps2).toBe(0.9);
      expect(assigned.profile.decelMps2).toBe(2.1);
    });
  });

  it('an assigned kind with no motion fields falls back to the app defaults for each independently', () => {
    const kindNoMotion: TransitSystem = {
      ...sysNoKinds,
      vehicleKinds: [{ id: 'evk2', modeId: 'bus', label: 'No motion set', widthM: 3, lengthM: 20 }],
    };
    const assignedNoMotion = effectiveVehicleKind(kindNoMotion.vehicleKinds, {
      ...busService,
      vehicleKindId: 'evk2',
    });
    expect(assignedNoMotion.profile.speedMps).toBe(DEFAULT_MOTION_PROFILE.speedMps);
    expect(assignedNoMotion.profile.accelMps2).toBe(DEFAULT_MOTION_PROFILE.accelMps2);
    expect(assignedNoMotion.profile.decelMps2).toBe(DEFAULT_MOTION_PROFILE.decelMps2);
  });

  it('a vehicleKindId pointing at a deleted kind falls back to the mode default, not a crash', () => {
    const danglingRef = effectiveVehicleKind(sysNoKinds.vehicleKinds, {
      ...busService,
      vehicleKindId: 'does-not-exist',
    });
    const busDefault = vehicleFootprint('bus');
    expect(danglingRef.widthM).toBe(busDefault.widthM);
  });
});

describe("dwellStopsForPattern: only stations anchored to the pattern's OWN ways count, ordered by arc-length along the resolved path (not by way index or station-array order)", () => {
  const path: LngLat[] = [
    [-115.24, 36.1],
    [-115.17, 36.1],
  ];
  const sys = createEmptySystem();
  sys.stops = [
    { id: 'near-end', coord: [-115.19, 36.1], anchors: [{ wayId: 'w1', t: 0.7 }] },
    { id: 'near-start', coord: [-115.22, 36.1], anchors: [{ wayId: 'w1', t: 0.2 }] },
    {
      id: 'custom-dwell',
      coord: [-115.2, 36.1],
      anchors: [{ wayId: 'w1', t: 0.5 }],
      dwellSeconds: 5,
    },
    { id: 'other-way', coord: [-115.2, 36.1005], anchors: [{ wayId: 'w2', t: 0.5 }] },
    { id: 'unanchored', coord: [-115.2, 36.1], anchors: [] },
  ];
  const pathMeters = haversineMeters(path[0], path[1]);
  const pattern = { id: 'p1', sections: oneSection(legsOf('w1')) };
  const stops = dwellStopsForPattern(sys.stops, pattern, path, pathMeters);

  it("only stations anchored to the pattern's ways become stops", () => {
    expect(stops.length).toBe(3);
  });

  it('a stop past where the line terminates is not a dwell on it', () => {
    // A line covering only the first 60% of w1 does not call at the stop at
    // t=0.7. Left unfiltered that stop projects onto the nearest end of the
    // trimmed path and stacks a phantom dwell on the terminus.
    const trimmedStops = dwellStopsForPattern(
      sys.stops,
      { id: 'p2', sections: oneSection([stretchLeg(wholeLeg('w1'), 0, 0.6)]) },
      path,
      pathMeters,
    );
    expect(trimmedStops.length).toBe(2);
  });

  it('stops are ordered by distance along the path, not input order', () => {
    expect(stops[0].distMeters).toBeLessThan(stops[1].distMeters);
    expect(stops[1].distMeters).toBeLessThan(stops[2].distMeters);
  });

  it('an unset dwell falls back to the default', () => {
    expect(stops[0].dwellMs).toBe(20000);
    expect(stops[2].dwellMs).toBe(20000);
  });

  it("a station's own dwellSeconds overrides the default", () => {
    expect(stops[1].dwellMs).toBe(5000);
  });
});
