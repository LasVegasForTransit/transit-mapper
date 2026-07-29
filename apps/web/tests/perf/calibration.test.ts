import { describe, expect, it } from 'vitest';
import { summarizeDisplayCadence } from '../../src/perf/calibration';

describe('display cadence calibration', () => {
  it('reports the median frame interval and inferred refresh rate as diagnostics', () => {
    expect(summarizeDisplayCadence([16.8, 16.6, 16.7, 16.5, 16.9])).toEqual({
      displayFrameIntervalMedianMs: 16.7,
      estimatedDisplayRefreshHz: 1000 / 16.7,
    });
  });
});
