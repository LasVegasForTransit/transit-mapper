import { init, type AnalyticsHandle, type InitOptions } from '@lasvegasfortransit/analytics';

const SITE = 'map.lasvegasfortransit.org';

function analyticsToken(environment: unknown): string | undefined {
  if (
    typeof environment !== 'object' ||
    environment === null ||
    !('PUBLIC_LVBT_CWA_TOKEN' in environment)
  ) {
    return undefined;
  }
  const token: unknown = environment.PUBLIC_LVBT_CWA_TOKEN;
  return typeof token === 'string' ? token : undefined;
}

export function transitMapperAnalyticsOptions(
  token = analyticsToken(import.meta.env),
): InitOptions {
  return {
    site: SITE,
    token,
    exclude: [/^\/e\//],
    noPageviews: [/^\/s\//],
    spa: true,
  };
}

export function startTransitMapperAnalytics(token?: string): AnalyticsHandle {
  return init(transitMapperAnalyticsOptions(token));
}
