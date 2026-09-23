import { init, type AnalyticsHandle, type InitOptions } from '@lasvegasfortransit/analytics';

const MAP_SITE = 'map.lasvegasfortransit.org';
const LABS_SITE = 'labs.lasvegasfortransit.org';

function analyticsToken(environment: unknown, name: string): string | undefined {
  if (typeof environment !== 'object' || environment === null || !(name in environment)) {
    return undefined;
  }
  const token: unknown = Reflect.get(environment, name);
  return typeof token === 'string' ? token : undefined;
}

export function transitMapperAnalyticsOptions(
  mapToken = analyticsToken(import.meta.env, 'PUBLIC_LVBT_CWA_TOKEN'),
  labsToken = analyticsToken(import.meta.env, 'PUBLIC_LVBT_LABS_CWA_TOKEN'),
  hostname = location.hostname,
): InitOptions {
  const onLabs = hostname === LABS_SITE;
  return {
    site: onLabs ? LABS_SITE : MAP_SITE,
    token: onLabs ? labsToken : mapToken,
    exclude: [onLabs ? /^\/transit-mapper\/e\// : /^\/e\//],
    noPageviews: [onLabs ? /^\/transit-mapper\/s\// : /^\/s\//],
    spa: true,
  };
}

export function startTransitMapperAnalytics(
  mapToken?: string,
  labsToken?: string,
): AnalyticsHandle {
  return init(transitMapperAnalyticsOptions(mapToken, labsToken));
}
