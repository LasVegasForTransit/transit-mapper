#!/usr/bin/env tsx
/**
 * Keeps every origin that is not production out of search indexes.
 *
 * A pull request preview is a public URL, posted as a comment on a public
 * repository, so search engines can find it. Left alone it would be indexed as
 * a duplicate of the live site, and unreleased work would be indexed before it
 * ships.
 *
 * The Worker already sends `X-Robots-Tag: noindex` on every page it renders
 * (see withHtmlSecurityHeaders in apps/worker/src/index.ts), so share pages,
 * views and embeds are covered on any origin. This handles what the Worker
 * never sees: `/`, `/privacy`, `/robots.txt`, `/sitemap.xml` and the rest of
 * the asset store, which `run_worker_first` deliberately leaves to Cloudflare
 * to serve directly.
 *
 * A header rather than `Disallow: /`, for the reason public/robots.txt already
 * records about share pages: `Disallow` stops a crawler fetching the page at
 * all, and a page it cannot fetch is a page whose `noindex` it never reads.
 * Fetchable but unindexed is the combination wanted here — it also leaves link
 * unfurls working, since preview bots do not honour `X-Robots-Tag`.
 *
 * Cloudflare does not do any of this for you. `*.workers.dev` is not
 * automatically noindexed; that behaviour belongs to Pages preview
 * deployments, and the documented fix for Workers is this header.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { resolveBuildOutputDirectory } from '../build-output';
import { PRODUCTION_ORIGIN } from './production-origin';

const NOINDEX_HEADER = 'X-Robots-Tag: noindex';

/**
 * The origin this build tells browsers it is served from.
 *
 * Read back out of the built HTML rather than from `VITE_SITE_URL`, so the
 * header can never disagree with the page: the canonical *is* the substituted
 * value, and reading the artifact means one source of truth instead of two.
 */
export function siteOriginFromIndexHtml(html: string): string {
  const href = /<link\s+rel="canonical"\s+href="([^"]+)"/u.exec(html)?.[1];
  if (!href) {
    throw new Error('No <link rel="canonical"> in the built index.html to read the origin from.');
  }
  try {
    return new URL(href).origin;
  } catch {
    throw new Error(`The canonical href in the built index.html is not a URL: ${href}`);
  }
}

/**
 * Adds the noindex header to the block that covers every path.
 *
 * Inserted into the existing `/*` block rather than appended as a second one,
 * because whether the asset store merges two blocks with the same pattern or
 * lets one shadow the other is not something this should depend on.
 */
export function withNoindex(headers: string): string {
  const lines = headers.split('\n');

  // Compared line by line, not as a substring of the file: the file documents
  // this header in a comment, and a comment describing the rule is not the
  // rule. Substring matching here would silently skip the insert and ship an
  // indexable preview.
  if (lines.some((line) => line.trim() === NOINDEX_HEADER)) return headers;

  const block = lines.indexOf('/*');
  if (block < 0) {
    throw new Error(
      'No "/*" block in _headers to add X-Robots-Tag to. If the file was restructured, ' +
        'this transform needs updating rather than silently doing nothing.',
    );
  }

  lines.splice(
    block + 1,
    0,
    '  # Added for this build by scripts/deployment/crawl-directives.ts: this is',
    '  # not the production origin, so nothing here belongs in a search index.',
    `  ${NOINDEX_HEADER}`,
  );
  return lines.join('\n');
}

/**
 * Drops the sitemap pointer, which names production and is wrong anywhere else.
 *
 * `User-agent`/`Allow` stay: a crawler has to be allowed to fetch the page to
 * see the noindex header that keeps it out of the index.
 */
export function robotsWithoutSitemap(robots: string): string {
  const lines = robots.split('\n').filter((line) => !line.startsWith('Sitemap:'));
  return `${lines.join('\n').trimEnd()}\n`;
}

export interface CrawlDirectiveOptions {
  distDirectory: string;
  productionOrigin: string;
}

export interface CrawlDirectiveResult {
  origin: string;
  indexable: boolean;
}

export function applyCrawlDirectives(options: CrawlDirectiveOptions): CrawlDirectiveResult {
  const { distDirectory, productionOrigin } = options;
  const origin = siteOriginFromIndexHtml(
    readFileSync(resolve(distDirectory, 'index.html'), 'utf8'),
  );
  if (origin === productionOrigin) return { origin, indexable: true };

  const headers = resolve(distDirectory, '_headers');
  writeFileSync(headers, withNoindex(readFileSync(headers, 'utf8')), 'utf8');

  const robots = resolve(distDirectory, 'robots.txt');
  writeFileSync(robots, robotsWithoutSitemap(readFileSync(robots, 'utf8')), 'utf8');

  // A sitemap naming another origin's URLs is ignored by every crawler that
  // reads it, and misleading to anyone who opens it.
  rmSync(resolve(distDirectory, 'sitemap.xml'), { force: true });

  return { origin, indexable: false };
}

function main(): void {
  const result = applyCrawlDirectives({
    distDirectory: resolveBuildOutputDirectory(
      resolve(import.meta.dirname, '../..'),
      process.env.VITE_PERF_BUILD === '1',
    ),
    productionOrigin: PRODUCTION_ORIGIN,
  });

  // Logged either way. A step that silently does nothing on the production
  // path is indistinguishable from a step that never ran at all.
  console.log(
    result.indexable
      ? `crawl directives: ${result.origin} is production — left indexable.`
      : `crawl directives: ${result.origin} is not production — noindex applied, sitemap removed.`,
  );
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
