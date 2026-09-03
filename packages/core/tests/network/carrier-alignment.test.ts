import { describe, expect, it } from 'vitest';
import {
  mapNormalizedPosition,
  mapNormalizedRange,
  sameNormalizedRange,
} from '../../src/network/carrier-alignment';

describe('carrier-to-Alignment range mapping', () => {
  it('uses the binding operation order for non-dyadic positions', () => {
    expect(mapNormalizedPosition(0.3, [0.1, 0.9], [0.2, 0.7])).toBe(0.32499999999999996);
    expect(mapNormalizedRange([0.3, 0.5], [0.1, 0.9], [0.2, 0.7])).toEqual([
      0.32499999999999996, 0.44999999999999996,
    ]);
  });

  it('preserves declared endpoints without recomputing them', () => {
    expect(mapNormalizedRange([0.1, 0.9], [0.1, 0.9], [0.2, 0.7])).toEqual([0.2, 0.7]);
    expect(sameNormalizedRange([0.2, 0.7], [0.2, 0.7])).toBe(true);
  });
});
