import { describe, expect, it } from 'vitest';
import { percentile } from '../../src/perf/statistics';

describe('percentile', () => {
  it('uses ceil-rank on the sample count, pinning the rule the gates were recorded with', () => {
    // Four samples at p50 was the case where the two retired implementations
    // disagreed: round-rank on n - 1 answered 3, ceil-rank on n answers 2.
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 99)).toBe(5);
    expect(percentile([7], 50)).toBe(7);
  });

  it('returns zero for an empty sample set instead of inventing a measurement', () => {
    expect(percentile([], 95)).toBe(0);
  });

  it('clamps out-of-range percentiles to the sample bounds', () => {
    expect(percentile([1, 2, 3], 0)).toBe(1);
    expect(percentile([1, 2, 3], 100)).toBe(3);
  });
});
