import { expect, test } from 'vitest';
import { cloudflareReader } from '../src/cloudflare-read.ts';

test('reads every page with GET and never follows redirects', async () => {
  const calls: URL[] = [];
  const read = cloudflareReader('private-token', (url, init) => {
    calls.push(new URL(url));
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer private-token');
    return Promise.resolve(
      Response.json({
        success: true,
        result: [{ id: calls.length }],
        result_info: { page: calls.length, total_pages: 2 },
      }),
    );
  });
  expect(await read.list('accounts/example/workers/domains?hostname=labs.example.org')).toEqual([
    { id: 1 },
    { id: 2 },
  ]);
  expect(calls.map((url) => url.searchParams.get('page'))).toEqual(['1', '2']);
  expect(calls.every((url) => url.hostname === 'api.cloudflare.com')).toBe(true);
});

test('errors reveal neither credentials nor upstream response bodies', async () => {
  const read = cloudflareReader('private-token', () =>
    Promise.resolve(
      Response.json(
        { success: false, errors: [{ code: 10000, message: 'private-token' }] },
        { status: 403 },
      ),
    ),
  );
  await expect(read.list('accounts/example/workers/domains')).rejects.toThrow(
    'Cloudflare HTTP 403',
  );
  try {
    await read.list('accounts/example/workers/domains');
  } catch (error) {
    expect(String(error)).not.toContain('private-token');
  }
});

test('rejects external URLs, malformed replies, and nonadvancing pagination', async () => {
  let calls = 0;
  const read = cloudflareReader('private-token', () => {
    calls += 1;
    return Promise.resolve(
      Response.json({ success: true, result: [], result_info: { page: 1, total_pages: 2 } }),
    );
  });
  await expect(read.list('https://other.example/')).rejects.toThrow();
  await expect(read.list('../outside')).rejects.toThrow();
  expect(calls).toBe(0);
  await expect(read.list('accounts/example/workers/domains')).rejects.toThrow(/pagination/);
  const invalid = cloudflareReader('token', () => Promise.resolve(Response.json({ result: [] })));
  await expect(invalid.list('accounts/example/workers/domains')).rejects.toThrow(/response/);
});
