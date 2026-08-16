import { describe, expect, it, vi } from 'vitest';
import {
  cacheAdaptiveAssets,
  type AdaptiveCacheEnvironment,
  type AdaptiveCacheRunOptions,
} from '../../src/pwa/adaptive-cache';
import { ADAPTIVE_CACHE_NAME } from '../../src/pwa/adaptive-cache-contract';

class FakeCache {
  readonly entries = new Map<string, Response>();

  match(url: string): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(url)?.clone());
  }

  put(url: string, response: Response): Promise<void> {
    this.entries.set(url, response.clone());
    return Promise.resolve();
  }
}

function manifest(assets: { url: string; bytes: number }[]): Response {
  return new Response(JSON.stringify({ schemaVersion: 1, buildId: 'v1.2.3', assets }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(manifestResponse: Response) {
  const cache = new FakeCache();
  const assetResponses = new Map<string, Response>();
  const fetch = vi.fn((url: string) => {
    if (url === '/adaptive-assets.json') return Promise.resolve(manifestResponse.clone());
    return Promise.resolve(
      assetResponses.get(url)?.clone() ?? new Response('missing', { status: 404 }),
    );
  });
  const environment: AdaptiveCacheEnvironment = {
    estimateStorage: vi.fn(() => Promise.resolve({ quota: 1_000_000, usage: 0 })),
    fetch,
    openCache: vi.fn(() => Promise.resolve(cache)),
  };
  const options: AdaptiveCacheRunOptions = {
    returningOrInstalled: true,
    saveData: false,
    effectiveType: '4g',
    environment,
  };
  return { assetResponses, cache, environment, fetch, options };
}

describe('adaptive offline caching', () => {
  it.each([
    { returningOrInstalled: false, saveData: false, effectiveType: '4g' },
    { returningOrInstalled: true, saveData: true, effectiveType: '4g' },
    { returningOrInstalled: true, saveData: false, effectiveType: 'slow-2g' },
    { returningOrInstalled: true, saveData: false, effectiveType: '2g' },
  ])('defers before storage or network work when policy says not to run', async (policy) => {
    const context = setup(manifest([]));

    await expect(cacheAdaptiveAssets({ ...context.options, ...policy })).resolves.toBe('deferred');
    expect(context.environment.estimateStorage).not.toHaveBeenCalled();
    expect(context.fetch).not.toHaveBeenCalled();
  });

  it('checks quota before fetching the optional manifest', async () => {
    const context = setup(manifest([]));
    vi.mocked(context.environment.estimateStorage).mockResolvedValue({
      quota: 100_000,
      usage: 50_000,
    });

    await expect(cacheAdaptiveAssets(context.options)).resolves.toBe('deferred');
    expect(context.fetch).not.toHaveBeenCalled();
  });

  it('never schedules more than 64 KiB of declared payload in one session', async () => {
    const assets = [
      { url: '/assets/a.js', bytes: 40_000 },
      { url: '/assets/b.js', bytes: 20_000 },
      { url: '/assets/c.js', bytes: 5_000 },
    ];
    const context = setup(manifest(assets));
    for (const asset of assets) context.assetResponses.set(asset.url, new Response('asset'));

    await expect(cacheAdaptiveAssets(context.options)).resolves.toBe('adaptive-pending');
    expect(context.fetch.mock.calls.map(([url]) => url)).toEqual([
      '/adaptive-assets.json',
      '/assets/a.js',
      '/assets/b.js',
    ]);
    expect(context.cache.entries.has('/assets/c.js')).toBe(false);
  });

  it('does not charge already cached assets against the session budget', async () => {
    const assets = [
      { url: '/assets/a.js', bytes: 60_000 },
      { url: '/assets/b.js', bytes: 60_000 },
    ];
    const context = setup(manifest(assets));
    await context.cache.put('/assets/a.js', new Response('cached'));
    context.assetResponses.set('/assets/b.js', new Response('downloaded'));

    await expect(cacheAdaptiveAssets(context.options)).resolves.toBe('complete');
    expect(context.fetch.mock.calls.map(([url]) => url)).toEqual([
      '/adaptive-assets.json',
      '/assets/b.js',
    ]);
    expect(context.environment.openCache).toHaveBeenCalledWith(ADAPTIVE_CACHE_NAME);
  });

  it('reports complete without redownloading a fully populated cache', async () => {
    const context = setup(manifest([{ url: '/assets/a.js', bytes: 1 }]));
    await context.cache.put('/assets/a.js', new Response('cached'));

    await expect(cacheAdaptiveAssets(context.options)).resolves.toBe('complete');
    expect(context.fetch).toHaveBeenCalledOnce();
  });

  it('defers safely when an optional response fails', async () => {
    const context = setup(manifest([{ url: '/assets/a.js', bytes: 1 }]));

    await expect(cacheAdaptiveAssets(context.options)).resolves.toBe('deferred');
    expect(context.cache.entries.size).toBe(0);
  });
});
