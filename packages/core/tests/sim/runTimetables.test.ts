// What changes for the clock once a line's two directions can be different
// ground.
//
// The old kernel had one ruler: `2 * oneWayMs` for the cycle, and a return
// position computed as `totalMeters - metersAtElapsed(...)`. Both are exactly
// right while the return trip is the outward trip reversed, and both are
// unfixable once it is a different street of a different length. These pin the
// new behaviour AND pin that the old numbers are unchanged for a plain line,
// which is the part that must not regress.

import { describe, expect, it } from 'vitest';
import { planService, runStateAt } from '../../src/sim/fleet';
import {
  buildTimetable,
  metersAtElapsed,
  roundTripMs,
  type VehicleMotionProfile,
} from '../../src/sim/timetable';

const SPEED: VehicleMotionProfile = { speedMps: 10, accelMps2: 2, decelMps2: 2 }; // m/s, so 1 km takes just over 100 s

const out = buildTimetable(1000, [], SPEED);
/** A return trip half again as long — the couplet loops a longer way back. */
const longBack = buildTimetable(1500, [], SPEED);

describe('a line that comes back the way it went', () => {
  it('takes exactly twice the one-way time to go out and back', () => {
    expect(roundTripMs({ outbound: out, inbound: out })).toBe(2 * out.oneWayMs);
  });

  it('sizes the same fleet it did before directions existed', () => {
    const plan = planService(roundTripMs({ outbound: out, inbound: out }), 60_000);
    expect(plan).toEqual(planService(2 * out.oneWayMs, 60_000));
  });
});

describe('a line whose return trip is longer', () => {
  const timetables = { outbound: out, inbound: longBack };

  it('counts the round trip as the outward plus the return, not twice either', () => {
    expect(roundTripMs(timetables)).toBe(out.oneWayMs + longBack.oneWayMs);
    expect(roundTripMs(timetables)).not.toBe(2 * out.oneWayMs);
    expect(roundTripMs(timetables)).not.toBe(2 * longBack.oneWayMs);
  });

  it('needs a longer cycle than the outward trip alone would suggest', () => {
    const real = planService(roundTripMs(timetables), 60_000);
    const pretend = planService(2 * out.oneWayMs, 60_000);
    expect(real.cycleMs).toBeGreaterThan(pretend.cycleMs);
  });
});

describe('where a vehicle is', () => {
  const timetables = { outbound: out, inbound: longBack };
  const plan = planService(roundTripMs(timetables), 60_000);

  it('measures the outward trip from the start of the outward path', () => {
    const state = runStateAt(30_000, timetables, plan, 0, SPEED);
    expect(state.run).toBe('outbound');
    expect(state.distMeters).toBeCloseTo(metersAtElapsed(out, 30_000, SPEED), 6);
  });

  it('waits out its layover at the far end of the outward path', () => {
    const state = runStateAt(out.oneWayMs + plan.layoverMs / 2, timetables, plan, 0, SPEED);
    expect(state.phase).toBe('layover');
    expect(state.distMeters).toBe(out.totalMeters);
  });

  it('measures the return trip forward along the return path, not backward along the outward one', () => {
    const intoReturn = 30_000;
    const state = runStateAt(
      out.oneWayMs + plan.layoverMs + intoReturn,
      timetables,
      plan,
      0,
      SPEED,
    );
    expect(state.run).toBe('inbound');
    expect(state.distMeters).toBeCloseTo(metersAtElapsed(longBack, intoReturn, SPEED), 6);
    // The old mirroring would have put it here, on a ruler that is not even
    // the right length for the street it is driving.
    expect(state.distMeters).not.toBeCloseTo(
      out.totalMeters - metersAtElapsed(out, intoReturn, SPEED),
      6,
    );
  });

  it('finishes its cycle at the end of the return path', () => {
    const state = runStateAt(plan.cycleMs - plan.layoverMs / 2, timetables, plan, 0, SPEED);
    expect(state.phase).toBe('layover');
    expect(state.distMeters).toBe(longBack.totalMeters);
  });

  it('never reports a position past the end of the path it is driving', () => {
    for (let t = 0; t < plan.cycleMs; t += 1_000) {
      const state = runStateAt(t, timetables, plan, 0, SPEED);
      const limit = state.run === 'outbound' ? out.totalMeters : longBack.totalMeters;
      expect(state.distMeters).toBeGreaterThanOrEqual(0);
      expect(state.distMeters).toBeLessThanOrEqual(limit + 1e-6);
    }
  });
});

describe('a timetable carries its own ruler', () => {
  it('reaches exactly the end of its path after its own one-way time', () => {
    expect(metersAtElapsed(longBack, longBack.oneWayMs, SPEED)).toBeCloseTo(1500, 6);
  });

  it('cannot be walked against another path length by accident', () => {
    // The whole point of folding totalMeters into the timetable: there is no
    // argument left for a caller to pass the wrong one.
    expect(out.totalMeters).toBe(1000);
    expect(longBack.totalMeters).toBe(1500);
  });
});
