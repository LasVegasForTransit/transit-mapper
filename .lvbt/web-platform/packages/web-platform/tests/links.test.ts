import { describe, expect, it } from 'vitest';
import * as links from '../src/links';

describe('compiled site links', () => {
  it('rewrites configured canonical origins but preserves unrelated external destinations', () => {
    expect(typeof links.linksFromHtml).toBe('function');
    const result = links.linksFromHtml(
      '<a href="https://www.example.test/join/?a=1&amp;b=2">Join</a><img src="/logo.svg"><a href="https://other.test/a">Other</a>',
      '/events/',
      'http://127.0.0.1:1234',
      new Set(['https://example.test', 'https://www.example.test']),
    );
    expect(result.internal).toEqual([
      'http://127.0.0.1:1234/join/?a=1&b=2',
      'http://127.0.0.1:1234/logo.svg',
    ]);
    expect(result.external).toEqual(['https://other.test/a']);
  });
  it('retains every failed URL and returns external redirect destinations', async () => {
    expect(typeof links.checkInternalLinkResults).toBe('function');
    const origin = 'http://127.0.0.1:1234';
    const result = await links.checkInternalLinkResults(
      [`${origin}/one`, `${origin}/two`, `${origin}/go`],
      origin,
      (url) =>
        Promise.resolve(
          url.endsWith('/go')
            ? new Response('', { status: 302, headers: { location: 'https://other.test/join' } })
            : new Response('', { status: 404 }),
        ),
    );
    expect(
      result.results.filter((entry) => entry.status === 'fail').map((entry) => entry.url),
    ).toEqual([`${origin}/one`, `${origin}/two`]);
    expect(result.results[0]?.diagnostic).toMatch(/404/);
    expect(result.external).toEqual(['https://other.test/join']);
    expect(result.checked).toBe(3);
  });
  it('classifies transport failures as errors and invalid redirects as link failures', async () => {
    expect(typeof links.checkInternalLinkResults).toBe('function');
    const origin = 'http://127.0.0.1:1234';
    const result = await links.checkInternalLinkResults(
      [`${origin}/error`, `${origin}/loop`],
      origin,
      (url) => {
        if (url.endsWith('/error')) return Promise.reject(new Error('socket closed'));
        return Promise.resolve(new Response('', { status: 302, headers: { location: '/loop' } }));
      },
    );
    expect(result.results.map((entry) => entry.status)).toEqual(['error', 'fail']);
    expect(result.results[0]?.diagnostic).toMatch(/socket closed/);
    expect(result.results[1]?.diagnostic).toMatch(/redirect/i);
  });
});
