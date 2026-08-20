import { describe, expect, it } from 'vitest';
import { parsePerfCliOptions } from '../../scripts/perf/cli';

describe('performance CLI', () => {
  it('selects the one-sample pull-request smoke explicitly', () => {
    const options = parsePerfCliOptions(['--smoke', '--scenario', 'rtc']);

    expect(options.smoke).toBe(true);
    expect(options.scenarioId).toBe('rtc');
  });

  it('selects the public first-session phase independently', () => {
    const options = parsePerfCliOptions(['--first-session']);

    expect(options.firstSession).toBe(true);
    expect(options.onboarding).toBe(false);
    expect(options.scenarioId).toBeUndefined();
  });

  it('selects the onboarding smoke independently', () => {
    const options = parsePerfCliOptions(['--onboarding']);

    expect(options.onboarding).toBe(true);
    expect(options.firstSession).toBe(false);
    expect(options.requireBaseline).toBe(false);
  });

  it('records traces without implicitly refreshing the frozen baseline', () => {
    const options = parsePerfCliOptions(['--record']);

    expect(options.record).toBe(true);
    expect(options.freezeBaseline).toBe(false);
  });

  it('requires an explicit option to create the frozen baseline', () => {
    const options = parsePerfCliOptions(['--freeze-baseline']);

    expect(options.record).toBe(false);
    expect(options.freezeBaseline).toBe(true);
    expect(options.requireBaseline).toBe(false);
  });

  it('requires the frozen baseline for a normal audit by default', () => {
    expect(parsePerfCliOptions([]).requireBaseline).toBe(true);
  });
});
