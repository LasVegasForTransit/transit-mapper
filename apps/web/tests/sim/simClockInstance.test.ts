import { describe, expect, it } from 'vitest';
import { MS_PER_MINUTE } from '@transitmapper/core/sim/clock';
import { createSimClock } from '../../src/sim/simClock';

// The SimClock instance (apps/web/src/sim/simClock.ts). One clock is created
// and mutated across this whole narrative — the same object a real caller
// holds onto for a session — so these run in order against shared state
// rather than each starting from a fresh clock.
describe('the SimClock instance (apps/web/src/sim/simClock.ts)', () => {
  const clock = createSimClock({ startMs: 0 });

  it('a new clock starts where it was told to', () => {
    expect(clock.now()).toBe(0);
  });

  it('advancing a running clock at the default speed adds a simulated minute', () => {
    clock.advance(1000);
    expect(clock.now()).toBe(MS_PER_MINUTE);
  });

  it('a faster speed advances the clock further per real second', () => {
    clock.setSettings({ speedId: '2x', paused: false });
    clock.advance(1000);
    expect(clock.now()).toBe(3 * MS_PER_MINUTE);
  });

  let heldAt: number;
  it('a paused clock holds', () => {
    clock.setSettings({ speedId: '2x', paused: true });
    heldAt = clock.now();
    clock.advance(5000);
    expect(clock.now()).toBe(heldAt);
  });

  // Pausing must FREEZE the simulation, not hide it — vehicle position is a
  // function of this number, so a paused clock leaves every vehicle exactly
  // where it was rather than clearing the map.
  let seen: number | null = null;
  let unsubscribe: () => void;
  it('a paused clock notifies nobody', () => {
    unsubscribe = clock.subscribe((simMs) => {
      seen = simMs;
    });
    clock.advance(1000);
    expect(seen).toBeNull();
  });

  it('the clock can be jumped to a specific time', () => {
    clock.setTime(9 * MS_PER_MINUTE);
    expect(clock.now()).toBe(9 * MS_PER_MINUTE);
  });
  it('a jump notifies subscribers even while paused', () => {
    expect(seen).toBe(9 * MS_PER_MINUTE);
  });

  it('unsubscribing stops the notifications', () => {
    unsubscribe();
    clock.setTime(0);
    expect(seen).toBe(9 * MS_PER_MINUTE);
  });

  // Two instances, no shared state — the clock is created and injected, not
  // reached for, so a second one can't disturb the first.
  it('two clocks keep their own time', () => {
    const other = createSimClock({ startMs: 12 * MS_PER_MINUTE });
    other.advance(1000);
    expect(clock.now()).toBe(0);
    expect(other.now()).toBe(13 * MS_PER_MINUTE);
  });
});
