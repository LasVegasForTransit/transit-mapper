import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyCrawlDirectives,
  robotsWithoutSitemap,
  siteOriginFromIndexHtml,
  withNoindex,
} from '../../../scripts/deployment/crawl-directives';
import { PRODUCTION_ORIGIN } from '../../../scripts/deployment/production-origin';

/**
 * Read from the real files rather than fixtures, so restructuring either one
 * fails here rather than at deploy time on an origin nobody is watching.
 */
const appRoot = resolve(import.meta.dirname, '../../..');
const headers = readFileSync(resolve(appRoot, 'public/_headers'), 'utf8');
const robots = readFileSync(resolve(appRoot, 'public/robots.txt'), 'utf8');

const PREVIEW_ORIGIN = 'https://transitmapper-pr-9999.example.workers.dev';

describe('reading the origin a build advertises', () => {
  it('takes the origin from the canonical link', () => {
    expect(siteOriginFromIndexHtml(`<link rel="canonical" href="${PREVIEW_ORIGIN}/" />`)).toBe(
      PREVIEW_ORIGIN,
    );
  });

  it('refuses a document with no canonical, rather than assuming production', () => {
    // Assuming production here would ship an indexable preview.
    expect(() => siteOriginFromIndexHtml('<html></html>')).toThrow(/canonical/u);
  });

  it('refuses a canonical that is not a URL', () => {
    expect(() => siteOriginFromIndexHtml('<link rel="canonical" href="/" />')).toThrow(
      /not a URL/u,
    );
  });
});

describe('adding the noindex header', () => {
  it('puts it inside the block that covers every path', () => {
    const next = withNoindex(headers).split('\n');
    const block = next.indexOf('/*');
    const nextBlock = next.findIndex((line, index) => index > block && /^\S/u.test(line));
    const header = next.indexOf('  X-Robots-Tag: noindex');
    expect(block).toBeGreaterThanOrEqual(0);
    expect(header).toBeGreaterThan(block);
    expect(header).toBeLessThan(nextBlock);
  });

  it('leaves the headers the file already sets alone', () => {
    const next = withNoindex(headers);
    expect(next).toContain("Content-Security-Policy: frame-ancestors 'none'");
    expect(next).toContain('Strict-Transport-Security: max-age=63072000; includeSubDomains');
  });

  it('is idempotent, so a rebuilt dist does not accumulate copies', () => {
    expect(withNoindex(withNoindex(headers))).toBe(withNoindex(headers));
  });

  it('refuses a file with no catch-all block instead of doing nothing', () => {
    // A silent no-op here is an indexable preview, so this has to be loud.
    expect(() => withNoindex('/assets/*\n  Cache-Control: immutable\n')).toThrow(/"\/\*" block/u);
  });
});

describe('dropping the sitemap pointer', () => {
  it('removes the line naming production', () => {
    expect(robots).toMatch(/^Sitemap:/mu);
    expect(robotsWithoutSitemap(robots)).not.toMatch(/^Sitemap:/mu);
  });

  it('keeps the crawler allowed, because noindex has to be fetched to be read', () => {
    const next = robotsWithoutSitemap(robots);
    expect(next).toContain('User-agent: *');
    expect(next).toContain('Allow: /');
  });
});

describe('applying the directives to a build', () => {
  function buildFixture(origin: string): string {
    const dist = mkdtempSync(join(tmpdir(), 'transitmapper-crawl-'));
    writeFileSync(join(dist, 'index.html'), `<link rel="canonical" href="${origin}/" />`, 'utf8');
    writeFileSync(join(dist, '_headers'), headers, 'utf8');
    writeFileSync(join(dist, 'robots.txt'), robots, 'utf8');
    mkdirSync(join(dist, 'nested'), { recursive: true });
    writeFileSync(join(dist, 'sitemap.xml'), '<urlset />', 'utf8');
    return dist;
  }

  it('leaves a production build untouched', () => {
    const dist = buildFixture(PRODUCTION_ORIGIN);
    const result = applyCrawlDirectives({
      distDirectory: dist,
      productionOrigin: PRODUCTION_ORIGIN,
    });
    expect(result.indexable).toBe(true);
    expect(readFileSync(join(dist, '_headers'), 'utf8')).toBe(headers);
    expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).toBe(robots);
    expect(existsSync(join(dist, 'sitemap.xml'))).toBe(true);
  });

  it('de-indexes any other origin', () => {
    const dist = buildFixture(PREVIEW_ORIGIN);
    const result = applyCrawlDirectives({
      distDirectory: dist,
      productionOrigin: PRODUCTION_ORIGIN,
    });
    expect(result.indexable).toBe(false);
    expect(readFileSync(join(dist, '_headers'), 'utf8')).toContain('X-Robots-Tag: noindex');
    expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).not.toMatch(/^Sitemap:/mu);
    expect(existsSync(join(dist, 'sitemap.xml'))).toBe(false);
  });
});
