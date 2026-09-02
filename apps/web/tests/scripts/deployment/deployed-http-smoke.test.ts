import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  entryChunkFrom,
  formatCheck,
  parseArgs,
  runDeployedSmoke,
} from '../../../scripts/deployment/deployed-http-smoke';

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

/** A site that answers nothing, to stand in for a host still propagating. */
function unreachableSite(): string {
  // Port 1 is reserved and never listening, so every request fails to connect
  // rather than timing out.
  return 'http://127.0.0.1:1';
}

describe('the deployed HTTP smoke', () => {
  it('reads the fingerprinted entry chunk out of a built index.html', () => {
    const html = [
      '<!doctype html><html><head>',
      '<link rel="modulepreload" href="/assets/index-B7dK2p_x.js">',
      '<script type="module" crossorigin src="/assets/index-B7dK2p_x.js"></script>',
      '</head><body></body></html>',
    ].join('');
    expect(entryChunkFrom(html)).toBe('/assets/index-B7dK2p_x.js');
  });

  it('reports no entry chunk when the document references none', () => {
    expect(entryChunkFrom('<!doctype html><html><body>nothing here</body></html>')).toBeNull();
  });

  it('names the URL and both values when a check fails', () => {
    expect(
      formatCheck({
        label: 'a missing share page is 404, not the SPA shell',
        url: 'https://example.test/s/zzzzzzzzzz',
        want: '404',
        got: '200',
        ok: false,
      }),
    ).toBe(
      "FAIL  a missing share page is 404, not the SPA shell — wanted '404', got '200' (https://example.test/s/zzzzzzzzzz)",
    );
  });

  it('rejects a site argument that is not an HTTP URL', () => {
    expect(() => parseArgs(['--site', 'ftp://example.test'])).toThrow(/HTTP or HTTPS/u);
  });

  it('requires a site argument, because there is no sensible default origin', () => {
    expect(() => parseArgs([])).toThrow(/--site/u);
  });

  it('strips the trailing slash so joined paths do not double it', () => {
    expect(parseArgs(['--site', 'https://example.test/']).site).toBe('https://example.test');
  });

  it('reports a failed request as a failed check rather than throwing', async () => {
    // A transient failure used to escape runDeployedSmoke, abandoning every
    // remaining assertion and naming neither the route nor the expectation.
    const results = await runDeployedSmoke({
      site: unreachableSite(),
      distDirectory: '/nonexistent',
      propagation: { attempts: 1, intervalMs: 0 },
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => !result.ok)).toBe(true);
  });

  it('does not read a failed request as a present security header', async () => {
    // The header checks ask whether a header is there. A probe that reported
    // its failure reason through the same accessor made "the request failed"
    // indistinguishable from "the header is present", so these two passed
    // against a site that never answered.
    const results = await runDeployedSmoke({
      site: unreachableSite(),
      distDirectory: '/nonexistent',
      propagation: { attempts: 1, intervalMs: 0 },
    });
    const headerChecks = results.filter((result) => result.label.startsWith('assets carry'));
    expect(headerChecks).toHaveLength(2);
    expect(headerChecks.every((result) => !result.ok)).toBe(true);
  });

  it('does not follow redirects, so a redirected route cannot borrow another status', async () => {
    // A share page that 301s to something that answers 404 would satisfy the
    // "missing share is 404" assertion if redirects were followed, while the
    // route itself is not answering 404 at all.
    server = createServer((request, response) => {
      if (request.url?.startsWith('/s/')) {
        response.writeHead(301, { location: '/gone' });
        response.end();
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{}');
    });
    await new Promise<void>((ready) => server?.listen(0, '127.0.0.1', ready));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    const results = await runDeployedSmoke({
      site: `http://127.0.0.1:${String(port)}`,
      distDirectory: '/nonexistent',
      propagation: { attempts: 1, intervalMs: 0 },
    });
    const sharePage = results.find((result) => result.label.includes('missing share page'));
    expect(sharePage?.got).toBe('301');
    expect(sharePage?.ok).toBe(false);
  });

  it('fails the indexing checks when the origin cannot be reached', async () => {
    // A preview that never answered must not read as "correctly de-indexed".
    const results = await runDeployedSmoke({
      site: unreachableSite(),
      distDirectory: '/nonexistent',
      propagation: { attempts: 1, intervalMs: 0 },
    });
    const indexing = results.filter((result) => result.label.includes('indexable'));
    expect(indexing).toHaveLength(1);
    expect(indexing[0]?.ok).toBe(false);
  });

  it('accepts a non-production origin that sends noindex and drops its sitemap', async () => {
    server = createServer((request, response) => {
      if (request.url?.startsWith('/sitemap.xml')) {
        // Deleted from the build, so the SPA fallback answers instead.
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<html></html>');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html', 'x-robots-tag': 'noindex' });
      response.end('<html></html>');
    });
    await new Promise<void>((ready) => server?.listen(0, '127.0.0.1', ready));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    const results = await runDeployedSmoke({
      site: `http://127.0.0.1:${String(port)}`,
      distDirectory: '/nonexistent',
      propagation: { attempts: 1, intervalMs: 0 },
    });
    expect(results.find((result) => result.label.includes('not indexable'))?.ok).toBe(true);
    expect(results.find((result) => result.label.includes('no sitemap'))?.ok).toBe(true);
  });
});
