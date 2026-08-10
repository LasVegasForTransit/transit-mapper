import { parsePlaceResults } from '@transitmapper/core/model/geocode';

interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface PlaceSearchGateBinding {
  getByName(name: string): { reserve(): Promise<number> };
}

interface PlaceGatewayEnv {
  SITE_URL: string;
  NOMINATIM_URL?: string;
  PLACE_SEARCH_LIMITER?: RateLimiterBinding;
  PLACE_UPSTREAM_LIMITER?: RateLimiterBinding;
  PLACE_SEARCH_GATE?: PlaceSearchGateBinding;
}

interface GatewayExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface GatewayCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface PlaceGatewayDependencies {
  fetcher?: typeof fetch;
  cache?: GatewayCache;
  placeTimeoutMs?: number;
}

type PlaceFailureCode = 'upstream_busy' | 'upstream_timeout' | 'upstream_invalid';

const PLACE_CACHE_SECONDS = 7 * 24 * 60 * 60;
const PLACE_TIMEOUT_MS = 15_000;
const MAX_PLACE_RESPONSE_BYTES = 1024 * 1024;

class PlaceResponseTooLargeError extends Error {}

function jsonError(
  code: 'invalid_request' | PlaceFailureCode,
  error: string,
  retryable: boolean,
  options: { status: number; retryAfter?: string },
): Response {
  return Response.json(
    { code, error, retryable },
    {
      status: options.status,
      headers: options.retryAfter ? { 'retry-after': options.retryAfter } : undefined,
    },
  );
}

async function allowed(limiter: RateLimiterBinding | undefined, key: string): Promise<boolean> {
  if (!limiter) return false;
  return (await limiter.limit({ key })).success;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Place search canceled.', 'AbortError');
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error('Place search failed.'));
      },
    );
  });
}

async function readPlaceBody(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new Error('Missing place response body.');
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PLACE_RESPONSE_BYTES) throw new PlaceResponseTooLargeError();
      chunks.push(value);
    }
  } finally {
    if (length > MAX_PLACE_RESPONSE_BYTES || signal.aborted) await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

interface PlaceFetchResult {
  payload?: unknown;
  code?: PlaceFailureCode;
}

async function fetchPlacePayload(
  request: Request,
  dependencies: PlaceGatewayDependencies,
): Promise<PlaceFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Place search timed out.', 'TimeoutError')),
    dependencies.placeTimeoutMs ?? PLACE_TIMEOUT_MS,
  );
  try {
    const response = await withAbort(
      (dependencies.fetcher ?? fetch)(new Request(request, { signal: controller.signal })),
      controller.signal,
    );
    if (!response.ok) {
      await response.body?.cancel();
      return { code: 'upstream_busy' };
    }
    return { payload: JSON.parse(await readPlaceBody(response, controller.signal)) };
  } catch (error) {
    if (error instanceof PlaceResponseTooLargeError || error instanceof SyntaxError) {
      return { code: 'upstream_invalid' };
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { code: 'upstream_timeout' };
    }
    return { code: 'upstream_busy' };
  } finally {
    clearTimeout(timer);
  }
}

function failureResponse(code: PlaceFailureCode): Response {
  if (code === 'upstream_timeout') {
    return jsonError(code, 'Place search did not answer in time.', true, { status: 504 });
  }
  if (code === 'upstream_invalid') {
    return jsonError(code, 'Place search returned an invalid response.', false, { status: 502 });
  }
  return jsonError(code, 'Place search is temporarily unavailable.', true, { status: 503 });
}

function upstreamRequest(query: string, env: PlaceGatewayEnv): Request | undefined {
  if (!env.NOMINATIM_URL) return undefined;
  const url = new URL(env.NOMINATIM_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '6');
  url.searchParams.set('q', query);
  return new Request(url, {
    headers: {
      accept: 'application/json',
      'user-agent': `TransitMapper (+${env.SITE_URL})`,
    },
  });
}

async function reserveGlobalPlaceSearch(env: PlaceGatewayEnv): Promise<Response | undefined> {
  if (!env.PLACE_SEARCH_GATE) {
    return jsonError('upstream_busy', 'Place search is not configured.', true, { status: 503 });
  }
  let retryAfter: number;
  try {
    retryAfter = await env.PLACE_SEARCH_GATE.getByName('nominatim-search').reserve();
  } catch {
    return jsonError('upstream_busy', 'Place search is temporarily unavailable.', true, {
      status: 503,
    });
  }
  return retryAfter > 0
    ? jsonError('upstream_busy', 'Place search is temporarily busy. Try again shortly.', true, {
        status: 429,
        retryAfter: String(retryAfter),
      })
    : undefined;
}

/** Cached, explicit geocoding boundary with separate client and upstream budgets. */
export async function handlePlaceSearch(
  request: Request,
  env: PlaceGatewayEnv,
  context: GatewayExecutionContext,
  dependencies: PlaceGatewayDependencies = {},
): Promise<Response> {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (query.length === 0) {
    return jsonError('invalid_request', 'Enter a place to search for.', false, { status: 400 });
  }
  if (query.length > 200) {
    return jsonError('invalid_request', 'Place searches are limited to 200 characters.', false, {
      status: 400,
    });
  }
  const clientKey = request.headers.get('cf-connecting-ip') ?? 'local-client';
  if (!(await allowed(env.PLACE_SEARCH_LIMITER, clientKey))) {
    return jsonError('upstream_busy', 'Too many place searches. Try again in a minute.', true, {
      status: 429,
      retryAfter: '60',
    });
  }

  const cache = dependencies.cache ?? caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;
  if (!(await allowed(env.PLACE_UPSTREAM_LIMITER, 'nominatim-search'))) {
    return jsonError(
      'upstream_busy',
      'Place search is temporarily busy. Try again shortly.',
      true,
      {
        status: 429,
        retryAfter: '10',
      },
    );
  }
  const reservationFailure = await reserveGlobalPlaceSearch(env);
  if (reservationFailure) return reservationFailure;

  const outgoing = upstreamRequest(query, env);
  if (!outgoing) {
    return jsonError('upstream_busy', 'Place search is not configured.', true, { status: 503 });
  }
  const upstream = await fetchPlacePayload(outgoing, dependencies);
  if (upstream.code) return failureResponse(upstream.code);
  let results;
  try {
    results = parsePlaceResults(upstream.payload);
  } catch {
    return failureResponse('upstream_invalid');
  }
  const response = Response.json(
    { results },
    { headers: { 'cache-control': `public, max-age=${PLACE_CACHE_SECONDS}` } },
  );
  context.waitUntil(cache.put(request, response.clone()));
  return response;
}
