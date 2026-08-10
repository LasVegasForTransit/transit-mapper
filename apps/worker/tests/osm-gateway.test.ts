import { describe, expect, it, vi } from 'vitest';
import { handleOpenStreetMapWays, handlePlaceSearch } from '../src/osm-gateway';
import worker from '../src/index';

interface StoredResponse {
  url: string;
  response: Response;
}

class MemoryCache {
  private stored: StoredResponse[] = [];

  match(request: Request): Promise<Response | undefined> {
    return Promise.resolve(
      this.stored.find((entry) => entry.url === request.url)?.response.clone(),
    );
  }

  put(request: Request, response: Response): Promise<void> {
    this.stored = this.stored.filter((entry) => entry.url !== request.url);
    this.stored.push({ url: request.url, response: response.clone() });
    return Promise.resolve();
  }
}

function executionContext() {
  const promises: Promise<unknown>[] = [];
  return {
    waitUntil(promise: Promise<unknown>) {
      promises.push(promise);
    },
    async settle() {
      await Promise.all(promises);
    },
  };
}

function limiter(success = true) {
  return { limit: vi.fn(() => Promise.resolve({ success })) };
}

function placeGate(retryAfter = 0) {
  const reserve = vi.fn(() => Promise.resolve(retryAfter));
  return { reserve, getByName: vi.fn(() => ({ reserve })) };
}

describe('GET /api/places', () => {
  it('is registered on the deployed Worker router', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/api/places?q='),
      {},
      executionContext() as unknown as ExecutionContext,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('rejects a blank explicit search before calling upstream', async () => {
    const fetcher = vi.fn();
    const response = await handlePlaceSearch(
      new Request('https://example.com/api/places?q=%20'),
      { SITE_URL: 'https://example.com', PLACE_SEARCH_LIMITER: limiter() },
      executionContext(),
      { fetcher: fetcher as typeof fetch, cache: new MemoryCache() },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'invalid_request',
      error: 'Enter a place to search for.',
      retryable: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('identifies TransitMapper upstream and caches successful searches for seven days', async () => {
    const fetcher = vi.fn((request: Request) => {
      expect(request.headers.get('user-agent')).toBe('TransitMapper (+https://example.com)');
      expect(request.url.startsWith('https://geocoder.example/search?')).toBe(true);
      return Promise.resolve(
        new Response(JSON.stringify([{ display_name: 'Las Vegas', lat: '36.1', lon: '-115.1' }]), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;
    const cache = new MemoryCache();
    const upstreamLimiter = limiter();
    const env = {
      SITE_URL: 'https://example.com',
      NOMINATIM_URL: 'https://geocoder.example/search',
      PLACE_SEARCH_LIMITER: limiter(),
      PLACE_UPSTREAM_LIMITER: upstreamLimiter,
      PLACE_SEARCH_GATE: placeGate(),
    };

    const firstContext = executionContext();
    const first = await handlePlaceSearch(
      new Request('https://example.com/api/places?q=Las%20Vegas'),
      env,
      firstContext,
      { fetcher, cache },
    );
    await firstContext.settle();
    const second = await handlePlaceSearch(
      new Request('https://example.com/api/places?q=Las%20Vegas'),
      env,
      executionContext(),
      { fetcher, cache },
    );

    expect(await first.json()).toEqual({
      results: [{ label: 'Las Vegas', center: [-115.1, 36.1] }],
    });
    expect(second.headers.get('cache-control')).toBe('public, max-age=604800');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(upstreamLimiter.limit).toHaveBeenCalledTimes(1);
  });

  it('bounds stalled and oversized place responses', async () => {
    const common = {
      SITE_URL: 'https://example.com',
      NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search',
      PLACE_SEARCH_LIMITER: limiter(),
      PLACE_UPSTREAM_LIMITER: limiter(),
      PLACE_SEARCH_GATE: placeGate(),
    };
    const stalled = await handlePlaceSearch(
      new Request('https://example.com/api/places?q=Las%20Vegas'),
      common,
      executionContext(),
      {
        fetcher: vi.fn(() => new Promise<Response>(() => {})),
        cache: new MemoryCache(),
        placeTimeoutMs: 5,
      },
    );
    const oversized = await handlePlaceSearch(
      new Request('https://example.com/api/places?q=Henderson'),
      common,
      executionContext(),
      {
        fetcher: vi.fn(() =>
          Promise.resolve(new Response(JSON.stringify(['x'.repeat(1024 * 1024)]))),
        ),
        cache: new MemoryCache(),
      },
    );

    expect(stalled.status).toBe(504);
    expect(await stalled.json()).toMatchObject({ code: 'upstream_timeout', retryable: true });
    expect(oversized.status).toBe(502);
    expect(await oversized.json()).toMatchObject({ code: 'upstream_invalid', retryable: false });
  });

  it('limits uncached upstream searches across clients', async () => {
    const response = await handlePlaceSearch(
      new Request('https://example.com/api/places?q=Las%20Vegas'),
      {
        SITE_URL: 'https://example.com',
        NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search',
        PLACE_SEARCH_LIMITER: limiter(),
        PLACE_UPSTREAM_LIMITER: limiter(false),
      },
      executionContext(),
      { fetcher: vi.fn() as typeof fetch, cache: new MemoryCache() },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('10');
    expect(await response.json()).toMatchObject({ code: 'upstream_busy', retryable: true });
  });

  it('returns a visible retryable error when the place limit is reached', async () => {
    const response = await handlePlaceSearch(
      new Request('https://example.com/api/places?q=Las%20Vegas'),
      { SITE_URL: 'https://example.com', PLACE_SEARCH_LIMITER: limiter(false) },
      executionContext(),
      { fetcher: vi.fn() as typeof fetch, cache: new MemoryCache() },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.json()).toMatchObject({ code: 'upstream_busy', retryable: true });
  });
});

describe('GET /api/openstreetmap/ways', () => {
  const request = (query = '') =>
    new Request(
      `https://example.com/api/openstreetmap/ways?west=-115.2&south=36&east=-115.1&north=36.1&categories=road,bike${query}`,
    );
  const env = {
    SITE_URL: 'https://example.com',
    OSM_TILE_LIMITER: limiter(),
  };

  it('rejects unordered coordinates and tiles over 100 square kilometres', async () => {
    const dependencies = { fetcher: vi.fn() as typeof fetch, cache: new MemoryCache() };
    const inverted = await handleOpenStreetMapWays(
      new Request(
        'https://example.com/api/openstreetmap/ways?west=-115&south=36.1&east=-115.1&north=36&categories=road',
      ),
      env,
      executionContext(),
      dependencies,
    );
    const huge = await handleOpenStreetMapWays(
      new Request(
        'https://example.com/api/openstreetmap/ways?west=-116&south=35&east=-114&north=37&categories=road',
      ),
      env,
      executionContext(),
      dependencies,
    );

    expect(inverted.status).toBe(400);
    expect(huge.status).toBe(400);
    expect(await huge.json()).toMatchObject({ code: 'invalid_request', retryable: false });
    expect(dependencies.fetcher).not.toHaveBeenCalled();
  });

  it('fails over from a busy mirror and caches only the successful payload', async () => {
    const fetcherMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 504 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ elements: [{ type: 'way', id: 1 }] }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    const fetcher = fetcherMock as unknown as typeof fetch;
    const cache = new MemoryCache();
    const context = executionContext();

    const response = await handleOpenStreetMapWays(request(), env, context, { fetcher, cache });
    await context.settle();
    const cached = await handleOpenStreetMapWays(request(), env, executionContext(), {
      fetcher,
      cache,
    });

    expect(response.status).toBe(200);
    expect(await cached.json()).toEqual({ elements: [{ type: 'way', id: 1 }] });
    expect(cached.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const upstream = fetcherMock.mock.calls[1]?.[0] as Request;
    expect(upstream.headers.get('user-agent')).toBe('TransitMapper (+https://example.com)');
    expect(await upstream.text()).toContain('[timeout:25]');
  });

  it('rejects malformed successful JSON instead of treating it as an empty import', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ remark: 'not elements' }))),
    ) as typeof fetch;
    const response = await handleOpenStreetMapWays(request(), env, executionContext(), {
      fetcher,
      cache: new MemoryCache(),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: 'upstream_invalid',
      error: 'OpenStreetMap returned an invalid response.',
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('maps malformed element geometry to a structured invalid-upstream response', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(Response.json({ elements: [{ type: 'way', id: 1, geometry: [null] }] })),
    ) as typeof fetch;

    const response = await handleOpenStreetMapWays(request(), env, executionContext(), {
      fetcher,
      cache: new MemoryCache(),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'upstream_invalid', retryable: false });
  });

  it('cancels failed mirror bodies before trying another endpoint', async () => {
    let canceled = 0;
    const failedResponse = () =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled++;
          },
        }),
        { status: 503 },
      );
    const fetcher = vi.fn(() => Promise.resolve(failedResponse())) as typeof fetch;

    await handleOpenStreetMapWays(request(), env, executionContext(), {
      fetcher,
      cache: new MemoryCache(),
    });

    expect(canceled).toBe(2);
  });

  it('cuts off decoded responses above 12 MB and marks the tile for subdivision', async () => {
    const oversized = `{"elements":[],"padding":"${'x'.repeat(12 * 1024 * 1024)}"}`;
    const fetcher = vi.fn(() => Promise.resolve(new Response(oversized))) as typeof fetch;
    const response = await handleOpenStreetMapWays(request(), env, executionContext(), {
      fetcher,
      cache: new MemoryCache(),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'tile_too_dense', retryable: true });
  });

  it('preserves a dense-tile result when a later mirror returns invalid data', async () => {
    const oversized = `{"elements":[],"padding":"${'x'.repeat(12 * 1024 * 1024)}"}`;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(oversized))
      .mockResolvedValueOnce(Response.json({ elements: 'invalid' })) as unknown as typeof fetch;

    const response = await handleOpenStreetMapWays(request(), env, executionContext(), {
      fetcher,
      cache: new MemoryCache(),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'tile_too_dense', retryable: true });
  });

  it('aligns the gateway timeout beyond the 25-second query and reports timeouts as retryable', async () => {
    const fetcher = vi.fn((_request: Request) => new Promise<Response>(() => {})) as typeof fetch;
    const response = await handleOpenStreetMapWays(request(), env, executionContext(), {
      fetcher,
      cache: new MemoryCache(),
      endpointTimeoutMs: 5,
    });

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ code: 'upstream_timeout', retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps the mirror deadline active while a successful body is still arriving', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"elements":['));
            },
          }),
        ),
      )
      .mockResolvedValueOnce(Response.json({ elements: [] })) as unknown as typeof fetch;

    const response = await handleOpenStreetMapWays(request(), env, executionContext(), {
      fetcher,
      cache: new MemoryCache(),
      endpointTimeoutMs: 5,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ elements: [] });
  });
});
