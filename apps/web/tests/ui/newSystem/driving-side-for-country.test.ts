import { describe, expect, it } from 'vitest';
import { drivingSideForCountry } from '../../../src/ui/newSystem/driving-side-for-country';

describe('drivingSideForCountry', () => {
  it('recognizes left-driving countries that were absent from the original shortlist', () => {
    for (const countryCode of ['bw', 'fj', 'tl', 'zm', 'zw']) {
      expect(drivingSideForCountry(countryCode)).toBe('left');
    }
  });

  it('recognizes separately coded left-driving territories', () => {
    for (const countryCode of ['gg', 'hk', 'sh', 'vi']) {
      expect(drivingSideForCountry(countryCode)).toBe('left');
    }
  });

  it('keeps right-driving and missing country results distinct', () => {
    expect(drivingSideForCountry('CN')).toBe('right');
    expect(drivingSideForCountry('so')).toBe('right');
    expect(drivingSideForCountry('us')).toBe('right');
    expect(drivingSideForCountry(undefined)).toBeUndefined();
  });
});
