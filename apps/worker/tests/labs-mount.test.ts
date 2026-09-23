import { describe, expect, it, vi } from 'vitest';
import { fetchLabsMount, isLabsMount, labsAssetPath } from '../src/labs-mount';

describe('Labs mount routing', () => {
  it('accepts only the exact project path on the Labs hostname', () => {
    expect(isLabsMount(new Request('https://labs.lasvegasfortransit.org/transit-mapper'))).toBe(
      true,
    );
    expect(
      isLabsMount(new Request('https://labs.lasvegasfortransit.org/transit-mapper/assets/app.js')),
    ).toBe(true);
    expect(isLabsMount(new Request('https://labs.lasvegasfortransit.org/transit-mapper-old'))).toBe(
      false,
    );
    expect(isLabsMount(new Request('https://map.lasvegasfortransit.org/transit-mapper'))).toBe(
      false,
    );
  });

  it('serves built assets directly while preserving API and reader routes', () => {
    for (const path of ['/', '/assets/app.js', '/favicon.ico', '/other-client-route']) {
      expect(labsAssetPath(path)).toBe(true);
    }
    for (const path of ['/api/systems', '/s/abc', '/e/abc', '/v/abc', '/embed/abc']) {
      expect(labsAssetPath(path)).toBe(false);
    }
  });

  it('strips the mount before asking the asset binding for a built file', async () => {
    const assetFetch = vi.fn((_request: Request) => Promise.resolve(new Response('asset')));
    const appFetch = vi.fn((_request: Request) => Promise.resolve(new Response('app')));
    const env = { ASSETS: { fetch: assetFetch } } as unknown as Env;
    const request = new Request('https://labs.lasvegasfortransit.org/transit-mapper/assets/app.js');

    const response = await fetchLabsMount(request, env, {} as ExecutionContext, appFetch);

    expect(await response.text()).toBe('asset');
    expect(new URL(assetFetch.mock.calls[0][0].url).pathname).toBe('/assets/app.js');
    expect(appFetch).not.toHaveBeenCalled();
  });

  it('strips the mount before dispatching a reader request', async () => {
    const assetFetch = vi.fn((_request: Request) => Promise.resolve(new Response('asset')));
    const appFetch = vi.fn((_request: Request) => Promise.resolve(new Response('app')));
    const env = { ASSETS: { fetch: assetFetch } } as unknown as Env;
    const request = new Request('https://labs.lasvegasfortransit.org/transit-mapper/s/example');

    const response = await fetchLabsMount(request, env, {} as ExecutionContext, appFetch);

    expect(await response.text()).toBe('app');
    expect(new URL(appFetch.mock.calls[0][0].url).pathname).toBe('/s/example');
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it('leaves the canonical map hostname rooted', async () => {
    const assetFetch = vi.fn((_request: Request) => Promise.resolve(new Response('asset')));
    const appFetch = vi.fn((_request: Request) => Promise.resolve(new Response('app')));
    const env = { ASSETS: { fetch: assetFetch } } as unknown as Env;
    const request = new Request('https://map.lasvegasfortransit.org/api/places');

    const response = await fetchLabsMount(request, env, {} as ExecutionContext, appFetch);

    expect(await response.text()).toBe('app');
    expect(new URL(appFetch.mock.calls[0][0].url).pathname).toBe('/api/places');
    expect(assetFetch).not.toHaveBeenCalled();
  });
});
