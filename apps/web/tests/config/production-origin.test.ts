import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_ORIGIN } from '../../scripts/deployment/production-origin';

/**
 * The production origin is written down in five places, each read by a
 * different tool that cannot import TypeScript: vite's env file, wrangler's
 * vars, robots.txt, the sitemap, and the deploy workflow. They cannot be
 * collapsed into one, so this pins them together instead.
 *
 * It matters more than it looks. `scripts/deployment/crawl-directives.ts`
 * decides whether a build is indexable by comparing the canonical origin — the
 * substituted `VITE_SITE_URL` — against this constant. If those two drift, the
 * live site de-indexes itself on the next deploy.
 */
const repositoryRoot = resolve(import.meta.dirname, '../../../..');
const read = (path: string): string => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('every copy of the production origin', () => {
  it('matches in the web build environment', () => {
    expect(read('apps/web/.env')).toContain(`VITE_SITE_URL=${PRODUCTION_ORIGIN}`);
  });

  it('matches in the Worker vars', () => {
    expect(read('apps/worker/wrangler.toml')).toContain(`SITE_URL = "${PRODUCTION_ORIGIN}"`);
  });

  it('matches in the sitemap pointer robots.txt publishes', () => {
    expect(read('apps/web/public/robots.txt')).toContain(
      `Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml`,
    );
  });

  it('matches every location the sitemap lists', () => {
    const locations = [...read('apps/web/public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/gu)];
    expect(locations.length).toBeGreaterThan(0);
    for (const [, location] of locations) {
      expect(location).toMatch(new RegExp(`^${PRODUCTION_ORIGIN}`, 'u'));
    }
  });

  it('matches the origin the production deploy verifies', () => {
    expect(read('.github/workflows/deploy-production.yml')).toContain(PRODUCTION_ORIGIN);
  });
});
