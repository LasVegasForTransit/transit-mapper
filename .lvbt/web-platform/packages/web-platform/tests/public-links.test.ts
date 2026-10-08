import { describe, expect, it } from 'vitest';
import { publicLinkReport, type LinkRequest } from '../src/links.js';

describe('live public link reports', () => {
  it('discovers current public pages and checks their actual routes without compiled output', async () => {
    const requested: string[] = [];
    const pages: Record<string, string> = {
      '/sitemap-index.xml':
        '<sitemapindex><sitemap><loc>https://public.test/sitemap-0.xml</loc></sitemap></sitemapindex>',
      '/sitemap-0.xml': '<urlset><url><loc>https://public.test/current</loc></url></urlset>',
      '/': '<a href="/current">Current</a>',
      '/current':
        '<a href="/missing">Missing</a><a href="https://outside.test/current">External</a>',
    };
    const request: LinkRequest = (url) => {
      requested.push(url);
      return Promise.resolve(
        new Response(pages[new URL(url).pathname] ?? '', {
          status: new URL(url).pathname === '/missing' ? 404 : 200,
        }),
      );
    };
    const report = await publicLinkReport('https://public.test', request);
    expect(report.results.find((result) => result.url.endsWith('/missing'))).toMatchObject({
      status: 'fail',
      source: 'https://public.test/current',
    });
    expect(report.external).toEqual(['https://outside.test/current']);
    expect(requested.every((url) => url.startsWith('https://public.test/'))).toBe(true);
    expect(report.checked).toBe(3);
  });
  it('fails closed when the current public sitemap is unavailable or malformed', async () => {
    await expect(
      publicLinkReport('https://public.test', () =>
        Promise.resolve(new Response('', { status: 404 })),
      ),
    ).rejects.toThrow(/404/);
    await expect(
      publicLinkReport('https://public.test', () =>
        Promise.resolve(new Response('<html>Unavailable</html>')),
      ),
    ).rejects.toThrow(/sitemap/);
  });
  it('rejects foreign sitemap routes rather than crawling another website', async () => {
    await expect(
      publicLinkReport('https://public.test', () =>
        Promise.resolve(
          new Response('<urlset><url><loc>https://foreign.test/</loc></url></urlset>'),
        ),
      ),
    ).rejects.toThrow(/outside/);
  });
});
