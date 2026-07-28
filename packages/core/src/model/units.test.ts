import { describe, expect, it } from 'vitest';
import {
  formatDistance,
  lengthFromMeters,
  lengthToMeters,
  speedFromKmh,
  speedToKmh,
} from './units';

describe('editable unit conversions', () => {
  it('round-trips an imperial vehicle dimension without rounding it', () => {
    const feet = lengthFromMeters(2.6, 'imperial');

    expect(feet).toBeCloseTo(8.530183727, 9);
    expect(lengthToMeters(feet, 'imperial')).toBeCloseTo(2.6, 12);
  });

  it('round-trips an imperial vehicle speed without rounding it', () => {
    const mph = speedFromKmh(80, 'imperial');

    expect(mph).toBeCloseTo(49.709695379, 9);
    expect(speedToKmh(mph, 'imperial')).toBeCloseTo(80, 12);
  });
});

describe('formatted distances', () => {
  it('uses the selected unit system', () => {
    expect(formatDistance(1609.344, 'imperial')).toBe('1.0 mi');
    expect(formatDistance(1609.344, 'metric')).toBe('1.6 km');
  });
});
