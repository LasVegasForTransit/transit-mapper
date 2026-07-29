import { describe, expect, it } from 'vitest';
import {
  cameraChanged,
  drawChangedSystem,
  projectedPointChanged,
} from '../../src/perf/journeyProof';

describe('performance journey proof', () => {
  it('rejects a scripted pan that leaves the camera unchanged', () => {
    const before = { center: [-115.17, 36.17] as [number, number], zoom: 11 };

    expect(cameraChanged(before, before)).toBe(false);
    expect(cameraChanged(before, { ...before, center: [-115.16, 36.17] })).toBe(true);
  });

  it('proves a camera pan from a projected fixture target', () => {
    expect(projectedPointChanged({ x: 100, y: 50 }, { x: 100, y: 50 })).toBe(false);
    expect(projectedPointChanged({ x: 100, y: 50 }, { x: 112, y: 50 })).toBe(true);
  });

  it('accepts a draw only when the revision and model way count advance', () => {
    const before = { revision: 10, wayCount: 4 };

    expect(drawChangedSystem(before, { revision: 11, wayCount: 4 })).toBe(false);
    expect(drawChangedSystem(before, { revision: 10, wayCount: 5 })).toBe(false);
    expect(drawChangedSystem(before, { revision: 11, wayCount: 5 })).toBe(true);
  });
});
