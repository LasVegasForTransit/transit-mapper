import { describe, expect, it } from 'vitest';
import { PERF_FIRST_SESSION_BYTE_BUDGETS } from '../../perf.config';
import viteConfig from '../../vite.config';

describe('the first-session byte policy', () => {
  it('requires a thirty percent editor reduction and no public-surface regression', () => {
    expect(PERF_FIRST_SESSION_BYTE_BUDGETS).toEqual([
      {
        journey: 'new-user-editor',
        cacheState: 'cold',
        minimumReductionRatio: 0.3,
      },
      {
        journey: 'public-share',
        cacheState: 'cold',
        maximumRegressionRatio: 0,
      },
      {
        journey: 'cross-site-embed',
        cacheState: 'cold',
        maximumRegressionRatio: 0,
      },
    ]);
  });

  it('ships only the explicit modern-browser module contract', () => {
    expect(viteConfig.build?.target).toBe('es2022');
    expect(viteConfig.build?.modulePreload).toEqual({ polyfill: false });
  });
});
