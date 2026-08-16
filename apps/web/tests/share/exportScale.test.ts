import { describe, expect, it } from 'vitest';
import { formatScaleMeters, niceScaleMeters } from '../../src/share/exportScale';

describe('exportScale: niceScaleMeters / formatScaleMeters', () => {
  it('rounds down to the nearest 1/2/5 step', () => {
    expect(niceScaleMeters(347)).toBe(200);
  });

  it('picks an exact nice number unchanged', () => {
    expect(niceScaleMeters(500)).toBe(500);
  });

  it('works across a magnitude boundary', () => {
    expect(niceScaleMeters(950)).toBe(500);
  });

  it('formatScaleMeters stays in meters under 1km', () => {
    expect(formatScaleMeters(500)).toBe('500 m');
  });

  it('formatScaleMeters switches to km at 1000', () => {
    expect(formatScaleMeters(2000)).toBe('2 km');
  });
});
