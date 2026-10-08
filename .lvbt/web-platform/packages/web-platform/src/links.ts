function decodeAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_match, code: string) =>
      String.fromCodePoint(
        code.startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number(code),
      ),
    );
}
function resolveLink(
  value: string,
  base: string,
  localOrigin: string,
  canonicalOrigins: ReadonlySet<string>,
): URL | undefined {
  if (!value || value.startsWith('#')) return undefined;
  const url = new URL(decodeAttribute(value), base);
  if (!['http:', 'https:'].includes(url.protocol)) return undefined;
  if (canonicalOrigins.has(url.origin)) return new URL(`${url.pathname}${url.search}`, localOrigin);
  url.hash = '';
  return url;
}
export function linksFromHtml(
  html: string,
  pagePath: string,
  localOrigin: string,
  canonicalOrigins: ReadonlySet<string> = new Set(),
): { internal: string[]; external: string[] } {
  const base = new URL(pagePath, localOrigin).href;
  const internal = new Set<string>();
  const external = new Set<string>();
  // These are compiled HTML attributes, not source-code or Markdown links.
  const attributes =
    /\b(?:href|src|poster|action|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of html.matchAll(attributes)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    const values = /^srcset/i.test(match[0])
      ? raw.split(',').map((entry) => entry.trim().split(/\s+/)[0] ?? '')
      : [raw];
    for (const value of values) {
      const url = resolveLink(value, base, localOrigin, canonicalOrigins);
      if (url) (url.origin === localOrigin ? internal : external).add(url.href);
    }
  }
  return { internal: [...internal], external: [...external] };
}

export type LinkRequest = (
  url: string,
  options: { redirect: 'manual'; signal: AbortSignal },
) => Promise<Response>;
async function checkLink(
  initial: string,
  localOrigin: string,
  request: LinkRequest,
  canonicalOrigins: ReadonlySet<string>,
): Promise<string | undefined> {
  let url = initial;
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(url) || visited.size >= 8)
      throw new LinkFailure(`Invalid redirect chain: ${initial}`);
    visited.add(url);
    const response = await request(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    // Drain response bodies to release connections between the many local requests.
    await response.arrayBuffer();
    if (response.ok) return undefined;
    if (![301, 302, 303, 307, 308].includes(response.status))
      throw new LinkFailure(`Broken build link (${response.status}): ${initial}`);
    const location = response.headers.get('location');
    if (!location) throw new LinkFailure(`Redirect has no destination: ${url}`);
    const destination = resolveLink(location, url, localOrigin, canonicalOrigins);
    if (!destination) throw new LinkFailure(`Invalid redirect destination: ${url}`);
    if (destination.origin !== localOrigin) return destination.href;
    url = destination.href;
  }
}

class LinkFailure extends Error {}
export interface LinkResult {
  url: string;
  status: 'pass' | 'fail' | 'error';
  diagnostic?: string;
  source?: string;
}
export interface LinkReport {
  checked: number;
  results: LinkResult[];
  external: string[];
}
export async function checkInternalLinkResults(
  urls: Iterable<string>,
  localOrigin: string,
  request: LinkRequest = fetch,
  canonicalOrigins: ReadonlySet<string> = new Set(),
): Promise<LinkReport> {
  const results: LinkResult[] = [];
  const external = new Set<string>();
  for (const url of urls) {
    try {
      const redirected = await checkLink(url, localOrigin, request, canonicalOrigins);
      if (redirected) external.add(redirected);
      results.push({ url, status: 'pass' });
    } catch (error) {
      results.push({
        url,
        status: error instanceof LinkFailure ? 'fail' : 'error',
        diagnostic: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { checked: results.length, results, external: [...external] };
}
export async function checkInternalLinks(
  urls: Iterable<string>,
  localOrigin: string,
  request: LinkRequest = fetch,
  canonicalOrigins: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const report = await checkInternalLinkResults(urls, localOrigin, request, canonicalOrigins);
  const failed = report.results.find((result) => result.status !== 'pass');
  if (failed) throw new Error(failed.diagnostic);
  return report.external;
}

async function publicDocument(url: string, origin: string, request: LinkRequest): Promise<string> {
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(url) || visited.size >= 8) throw new Error(`Invalid public redirect: ${url}`);
    visited.add(url);
    const response = await request(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    if (response.ok) return body;
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location)
      throw new Error(`Public document HTTP ${response.status}: ${url}`);
    const destination = new URL(location, url);
    if (destination.origin !== origin)
      throw new Error(`Public document redirects outside ${origin}`);
    url = destination.href;
  }
}

function sitemapLocations(xml: string, sitemap: string): { index: boolean; locations: string[] } {
  const index = /<sitemapindex\b/.test(xml);
  if (!index && !/<urlset\b/.test(xml)) throw new Error(`Invalid public sitemap: ${sitemap}`);
  const locations = [...xml.matchAll(/<loc\b[^>]*>\s*([^<]+)\s*<\/loc>/g)].map((entry) =>
    (entry[1] ?? '').trim(),
  );
  if (!locations.length) throw new Error(`Empty public sitemap: ${sitemap}`);
  return { index, locations };
}

function publicSitemapRoute(
  location: string,
  sitemap: string,
  origin: string,
  canonicalOrigins: ReadonlySet<string>,
): string {
  const url = resolveLink(location, sitemap, origin, canonicalOrigins);
  if (url?.origin !== origin) throw new Error(`Public sitemap route outside ${origin}`);
  return url.href;
}

async function publicPages(
  origin: string,
  request: LinkRequest,
  canonicalOrigins: ReadonlySet<string>,
): Promise<Set<string>> {
  const sitemapQueue = [new URL('/sitemap-index.xml', origin).href];
  const seen = new Set<string>();
  const pages = new Set<string>([`${origin}/`]);
  for (let sitemap = sitemapQueue.shift(); sitemap; sitemap = sitemapQueue.shift()) {
    if (seen.has(sitemap)) continue;
    if (seen.size >= 50) throw new Error('Public sitemap exceeds 50 documents.');
    seen.add(sitemap);
    const xml = await publicDocument(sitemap, origin, request);
    const { index, locations } = sitemapLocations(xml, sitemap);
    for (const location of locations) {
      const route = publicSitemapRoute(location, sitemap, origin, canonicalOrigins);
      if (index) sitemapQueue.push(route);
      else pages.add(route);
      if (pages.size > 1000) throw new Error('Public sitemap exceeds 1000 pages.');
    }
  }
  return pages;
}
interface PublicCollection {
  internal: Set<string>;
  external: Set<string>;
  sources: Map<string, Set<string>>;
  documentFailures: LinkResult[];
}
async function collectPublicPage(
  page: string,
  options: { origin: string; request: LinkRequest; canonicalOrigins: ReadonlySet<string> },
  collection: PublicCollection,
): Promise<void> {
  try {
    const html = await publicDocument(page, options.origin, options.request);
    const links = linksFromHtml(html, page, options.origin, options.canonicalOrigins);
    for (const url of links.internal) {
      collection.internal.add(url);
      const owners = collection.sources.get(url) ?? new Set<string>();
      owners.add(page);
      collection.sources.set(url, owners);
    }
    for (const url of links.external) collection.external.add(url);
  } catch (error) {
    collection.internal.delete(page);
    collection.documentFailures.push({
      url: page,
      source: page,
      status: 'error',
      diagnostic: error instanceof Error ? error.message : String(error),
    });
  }
}
/** Discover pages from the live sitemap; compiled files never supply production evidence. */
export async function publicLinkReport(
  origin: string,
  request: LinkRequest = fetch,
  canonicalOrigins: ReadonlySet<string> = new Set(),
): Promise<LinkReport> {
  if (new URL(origin).origin !== origin || new URL(origin).protocol !== 'https:')
    throw new Error('Public link reports require an HTTPS origin.');
  const pages = await publicPages(origin, request, canonicalOrigins);
  const collection: PublicCollection = {
    internal: new Set(pages),
    external: new Set(),
    sources: new Map(),
    documentFailures: [],
  };
  for (const page of pages)
    await collectPublicPage(page, { origin, request, canonicalOrigins }, collection);
  const report = await checkInternalLinkResults(
    collection.internal,
    origin,
    request,
    canonicalOrigins,
  );
  for (const url of report.external) collection.external.add(url);
  return {
    checked: report.checked + collection.documentFailures.length,
    results: [
      ...report.results.map((entry) => ({
        ...entry,
        source: [...(collection.sources.get(entry.url) ?? [entry.url])].join(', '),
      })),
      ...collection.documentFailures,
    ],
    external: [...collection.external],
  };
}
