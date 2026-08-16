import { describe, expect, it } from 'vitest';
import { legRange, stretchLeg, wholeLeg } from '@transitmapper/core/model/geo';
import {
  removeStretchFromLegs,
  splitLegsAt,
  truncateLegs,
} from '@transitmapper/core/model/patternEdits';
import type { PatternLeg } from '@transitmapper/core/model/system';

// Trimming a line back, cutting one in two, and taking a stretch of road out
// from under one. All three used to be impossible: a service covered whole
// ways, so the only way to shorten a line was to delete it.
//
// Pure functions against hand-built leg arrays — no store involved.
describe('editing a line in pieces', () => {
  const legsFor = (...specs: [string, boolean, number?, number?][]): PatternLeg[] =>
    specs.map(([wayId, forward, fromT, toT]) => {
      const leg = wholeLeg(wayId, forward ? 'withPoints' : 'againstPoints');
      return fromT !== undefined && toT !== undefined ? stretchLeg(leg, fromT, toT) : leg;
    });
  /** A leg's covered stretch, for assertions that used to read fromT/toT. */
  const legFrom = (l: PatternLeg): number => legRange(l)[0];
  const legTo = (l: PatternLeg): number => legRange(l)[1];

  it('trimming a line back leaves it running only up to that point', () => {
    const trimEnd = truncateLegs(legsFor(['w', true]), 0, 0.6, 'end');
    expect(trimEnd).toHaveLength(1);
    expect(legFrom(trimEnd[0])).toBe(0);
    expect(Math.abs(legTo(trimEnd[0]) - 0.6)).toBeLessThan(1e-9);
  });

  it('trimming the other end of a line keeps the far side', () => {
    // …and trimming the START of that same leg keeps the high end.
    const trimStart = truncateLegs(legsFor(['w', true]), 0, 0.6, 'start');
    expect(trimStart).toHaveLength(1);
    expect(Math.abs(legFrom(trimStart[0]) - 0.6)).toBeLessThan(1e-9);
    expect(legTo(trimStart[0])).toBe(1);
  });

  it('trimming the start of a line that runs its way backward keeps the low end', () => {
    // A BACKWARD leg rides the way high-to-low, so "the start of the line" is
    // the way's high end. Getting this backward would trim the wrong half.
    const trimBackward = truncateLegs(legsFor(['w', false]), 0, 0.6, 'start');
    expect(trimBackward).toHaveLength(1);
    expect(legFrom(trimBackward[0])).toBe(0);
  });

  it('trimming a line back past a junction drops the ways beyond it', () => {
    const trimMulti = truncateLegs(legsFor(['a', true], ['b', true], ['c', true]), 1, 0.4, 'end');
    expect(trimMulti).toHaveLength(2);
    expect(trimMulti[1].wayId).toBe('b');
  });

  it('cutting a line in two gives each half the stretch on its own side', () => {
    const [near, far] = splitLegsAt(legsFor(['a', true], ['b', true]), 0, 0.5);
    expect(near).toHaveLength(1);
    expect(Math.abs(legTo(near[0]) - 0.5)).toBeLessThan(1e-9);
    expect(far).toHaveLength(2);
    expect(Math.abs(legFrom(far[0]) - 0.5)).toBeLessThan(1e-9);
  });

  it('cutting a line at its own terminus splits nothing off', () => {
    const [onEnd] = splitLegsAt(legsFor(['a', true]), 0, 0);
    expect(onEnd).toHaveLength(0);
  });

  it('removing a stretch from under a line leaves the pieces on both sides', () => {
    // Taking a stretch out of the middle of a way leaves the pieces either side.
    const holed = removeStretchFromLegs(legsFor(['w', true]), 'w', 0.4, 0.6);
    expect(holed).toHaveLength(2);
    expect(Math.abs(legTo(holed[0]) - 0.4)).toBeLessThan(1e-9);
    expect(Math.abs(legFrom(holed[1]) - 0.6)).toBeLessThan(1e-9);
  });

  it('a line running the way backward gets those pieces in ride order', () => {
    const holedBackward = removeStretchFromLegs(legsFor(['w', false]), 'w', 0.4, 0.6);
    expect(legFrom(holedBackward[0])).toBe(0.6);
  });

  it('removing a stretch a line does not reach leaves it alone', () => {
    const untouched = removeStretchFromLegs(legsFor(['w', true, 0, 0.3]), 'w', 0.4, 0.6);
    expect(untouched).toHaveLength(1);
  });

  it('removing the whole of what a line covers leaves it with nothing', () => {
    const removedWhole = removeStretchFromLegs(legsFor(['w', true]), 'w', 0, 1);
    expect(removedWhole).toHaveLength(0);
  });
});
