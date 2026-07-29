// Regression tests for two faults reported against a street-running light
// rail line drawn down South Decatur Boulevard, both visible in
// Infrastructure view: the trains rode a different lane than the line the map
// drew for them, and the outbound and return runs shared one lane and drove
// through each other.
//
// Both came from the same cause — the vehicle path and the service line each
// resolved "which lane" with their own code — so both are pinned here.

import { describe, expect, it } from 'vitest';
import {
  cumulativeLengths,
  haversineMeters,
  pointAtDistance,
  stretchLeg,
  wayById,
  oneSection,
  patternLegs,
} from '../../src/model/geo';
import { serviceLaneOnWay } from '../../src/model/geo/serviceLane';
import { planService, runStateAt } from '../../src/sim/fleet';
import { buildTimetable, roundTripMs, type VehicleMotionProfile } from '../../src/sim/timetable';
import { aPattern, aRoad } from '../support/fixtures.test';
import { wayLaneGeometry } from '../../src/geometry/streets';
import { patternLanePath } from '../../src/geometry/vehicleLane';

/** A north-south arterial with the default four drive lanes, two each way. */
const arterial = (id: string, fromLat: number, toLat: number) =>
  aRoad(id, [
    [-115.207, fromLat],
    [-115.207, toLat],
  ]);

const road = arterial('w', 36.14, 36.16);
const pattern = aPattern('p', [road], ['w']);

/** Where the map DRAWS this pattern's line on `road`: buildFeatures resolves
 *  the lane with serviceLaneOnWay, so that is the reference the vehicles have
 *  to match. */
function drawnLanePath(forward: boolean) {
  const laneId = serviceLaneOnWay(pattern, 0, wayById([road]), 'lightRail', forward);
  return wayLaneGeometry(road).lanes.find((l) => l.laneId === laneId)!.path;
}

describe('the lane a pattern rides', () => {
  it('puts the outbound run on the lane the map draws its line in', () => {
    const drawn = drawnLanePath(true);
    const ridden = patternLanePath([road], pattern, 'lightRail', 'outbound');
    expect(haversineMeters(drawn[0], ridden[0])).toBeLessThan(0.5);
  });

  it('puts the return run on the opposite lane, not the outbound one', () => {
    const out = patternLanePath([road], pattern, 'lightRail', 'outbound');
    const back = patternLanePath([road], pattern, 'lightRail', 'inbound');
    // The return runs the other way down the same street, so it starts level
    // with where the outbound finished — within a couple of lane widths, not
    // a couple of kilometres.
    expect(back[0][1]).toBeCloseTo(out[out.length - 1][1], 5);
    expect(back[back.length - 1][1]).toBeCloseTo(out[0][1], 5);
    // …and beside it, in the lane carrying the other direction. Sharing one
    // lane is the head-on collision this pins.
    expect(haversineMeters(back[0], out[out.length - 1])).toBeGreaterThan(3);
    expect(haversineMeters(back[back.length - 1], out[0])).toBeGreaterThan(3);
  });

  it('walks a multi-way pattern backwards on the return run', () => {
    const north = arterial('n', 36.16, 36.18);
    const ways = [road, north];
    const twoWay = aPattern('p2', ways, ['w', 'n']);
    const out = patternLanePath(ways, twoWay, 'lightRail', 'outbound');
    const back = patternLanePath(ways, twoWay, 'lightRail', 'inbound');
    expect(out[out.length - 1][1]).toBeCloseTo(36.18, 4);
    expect(back[0][1]).toBeCloseTo(36.18, 4);
    expect(back[back.length - 1][1]).toBeCloseTo(36.14, 4);
  });

  it('falls back to the centerline on a way with no lanes to resolve', () => {
    const bare = aRoad('bare', road.points, { profile: { lanes: [] } });
    const barePattern = aPattern('p3', [bare], ['bare']);
    const path = patternLanePath([bare], barePattern, 'lightRail', 'outbound');
    expect(path).toHaveLength(2);
    expect(haversineMeters(path[0], bare.points[0])).toBeLessThan(0.5);
  });

  it('rides only the stretch of a way a partial leg covers', () => {
    // A line terminating mid-block. The lane path is the way's FULL centerline
    // offset sideways, so without trimming it the vehicles ran the whole
    // street while the drawn line stopped where it should.
    const half = aPattern('p4', [road], ['w']);
    half.sections = oneSection([stretchLeg(patternLegs(half)[0], 0, 0.5)]);
    const whole = patternLanePath([road], pattern, 'lightRail', 'outbound');
    const partial = patternLanePath([road], half, 'lightRail', 'outbound');
    const lengthOf = (p: [number, number][]) => {
      const cum = cumulativeLengths(p);
      return cum[cum.length - 1];
    };
    expect(lengthOf(partial)).toBeCloseTo(lengthOf(whole) / 2, 0);
  });
});

describe('two runs of one light rail line', () => {
  // The reported symptom: trains meeting head-on and overlapping. Walk a whole
  // cycle and measure how close any two of the line's vehicles ever get,
  // placing each on the leg it is actually running.
  it('never puts two vehicles in the same place at the same time', () => {
    const long = arterial('long', 36.05, 36.25); // ~22 km, enough for a fleet
    const linePattern = aPattern('p', [long], ['long']);
    const profile: VehicleMotionProfile = { speedMps: 15, accelMps2: 2, decelMps2: 2 };
    const legs = {
      outbound: patternLanePath([long], linePattern, 'lightRail', 'outbound'),
      inbound: patternLanePath([long], linePattern, 'lightRail', 'inbound'),
    };
    const cum = {
      outbound: cumulativeLengths(legs.outbound),
      inbound: cumulativeLengths(legs.inbound),
    };
    const timetables = {
      outbound: buildTimetable(cum.outbound[cum.outbound.length - 1], [], profile),
      inbound: buildTimetable(cum.inbound[cum.inbound.length - 1], [], profile),
    };
    const plan = planService(roundTripMs(timetables), 10 * 60_000);
    expect(plan.fleet).toBeGreaterThan(1); // otherwise there is nothing to hit

    let closest = Infinity;
    for (let t = 0; t < plan.cycleMs; t += 250) {
      const points = [];
      for (let i = 0; i < plan.fleet; i++) {
        // No ruler conversion: distMeters is measured along the path its own
        // direction names. This used to need rescaling from the outbound
        // ruler onto the return lane, which is the arithmetic that could not
        // survive the two directions being different lengths.
        const { distMeters, run } = runStateAt(t, timetables, plan, i, profile);
        points.push(pointAtDistance(legs[run], cum[run], distMeters));
      }
      for (let a = 0; a < points.length; a++)
        for (let b = a + 1; b < points.length; b++)
          closest = Math.min(closest, haversineMeters(points[a], points[b]));
    }
    // Opposing trains do still pass each other — abreast, in the two curb
    // lanes, about 10 m apart. One lane width of clearance is the assertion
    // that matters: it says they are not in the same lane. The bug this pins
    // drove that figure to zero.
    expect(closest).toBeGreaterThan(3.35);
  });
});
