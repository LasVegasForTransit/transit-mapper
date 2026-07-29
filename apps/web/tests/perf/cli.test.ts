import { describe, expect, it } from 'vitest';
import { parsePerfCliOptions, perfUsage } from '../../scripts/perf/cli';

describe('performance CLI', () => {
  it('selects the one-sample pull-request smoke explicitly', () => {
    const options = parsePerfCliOptions(['--smoke', '--scenario', 'rtc']);

    expect(options.smoke).toBe(true);
    expect(options.scenarioId).toBe('rtc');
    expect(perfUsage()).toContain('--smoke');
  });
});
