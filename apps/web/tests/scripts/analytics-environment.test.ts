import { describe, expect, it } from 'vitest';
import { assertAnalyticsBuildEnvironment } from '../../scripts/analytics-environment';

describe('the analytics build environment', () => {
  it('rejects a production build without the shared token', () => {
    expect(() => assertAnalyticsBuildEnvironment({ LVBT_REQUIRE_ANALYTICS: '1' })).toThrow(
      'PUBLIC_LVBT_CWA_TOKEN',
    );
  });

  it('accepts production only when the shared token is nonblank', () => {
    expect(() =>
      assertAnalyticsBuildEnvironment({
        LVBT_REQUIRE_ANALYTICS: '1',
        PUBLIC_LVBT_CWA_TOKEN: ' analytics-token ',
      }),
    ).not.toThrow();
  });

  it('allows local, preview, and archive builds to omit analytics', () => {
    expect(() => assertAnalyticsBuildEnvironment({})).not.toThrow();
  });
});
