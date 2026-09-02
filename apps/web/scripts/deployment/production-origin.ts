/**
 * The one origin allowed to be indexed.
 *
 * Every other copy of this string — the committed `VITE_SITE_URL`, the Worker's
 * `SITE_URL` var, the `Sitemap:` line in robots.txt, the sitemap's own `<loc>`
 * entries, and the production deploy's environment URL — is pinned to this
 * constant by apps/web/tests/config/production-origin.test.ts. They stay
 * separate copies because each is read by a different tool that cannot import
 * TypeScript; the test is what stops them drifting apart.
 */
export const PRODUCTION_ORIGIN = 'https://map.lasvegasfortransit.org';
