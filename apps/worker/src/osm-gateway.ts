import {
  buildOverpassQuery,
  IMPORT_CATEGORY_ORDER,
  parseOsmElementsPayload,
  type ImportBBox,
  type ImportCategory,
  type OsmWayElement,
} from '@transitmapper/core/model/import';
import { importAreaKm2 } from '@transitmapper/core/model/import-area';

interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface GatewayEnv {
  SITE_URL: string;
  OSM_TILE_LIMITER?: RateLimiterBinding;
}

interface GatewayExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface GatewayCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface GatewayDependencies {
  fetcher?: typeof fetch;
  cache?: GatewayCache;
  endpointTimeoutMs?: number;
}

type GatewayErrorCode =
  'invalid_request' | 'upstream_busy' | 'upstream_timeout' | 'tile_too_dense' | 'upstream_invalid';

const OSM_CACHE_SECONDS = 24 * 60 * 60;
const OVERPASS_TIMEOUT_MS = 45_000;
const MAX_OSM_RESPONSE_BYTES = 12 * 1024 * 1024;
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const BUSY_STATUSES = new Set([429, 502, 503, 504]);

function jsonError(
  code: GatewayErrorCode,
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

function clientKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'local-client';
}

function cacheFor(dependencies: GatewayDependencies): GatewayCache {
  return dependencies.cache ?? caches.default;
}

function identifiedHeaders(siteUrl: string): Headers {
  return new Headers({
    accept: 'application/json',
    'user-agent': `TransitMapper (+${siteUrl})`,
  });
}

async function allowed(limiter: RateLimiterBinding | undefined, key: string): Promise<boolean> {
  if (!limiter) return false;
  return (await limiter.limit({ key })).success;
}

interface ParsedWaysRequest {
  bounds: ImportBBox;
  categories: ImportCategory[];
}

function finiteParameter(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === '') return undefined;
  const number = Number(raw);
  return Number.isFinite(number) ? number : undefined;
}

function parseBounds(url: URL): ImportBBox | undefined {
  const west = finiteParameter(url, 'west');
  const south = finiteParameter(url, 'south');
  const east = finiteParameter(url, 'east');
  const north = finiteParameter(url, 'north');
  if (
    west === undefined ||
    south === undefined ||
    east === undefined ||
    north === undefined ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north
  ) {
    return undefined;
  }
  return { west, south, east, north };
}

function parseWaysRequest(request: Request): ParsedWaysRequest | undefined {
  const url = new URL(request.url);
  const bounds = parseBounds(url);
  if (!bounds) return undefined;
  const rawCategories = url.searchParams.get('categories')?.split(',') ?? [];
  const categories = [...new Set(rawCategories)] as ImportCategory[];
  if (
    categories.length === 0 ||
    categories.some((category) => !IMPORT_CATEGORY_ORDER.includes(category))
  ) {
    return undefined;
  }
  if (importAreaKm2(bounds) > 100.000001) return undefined;
  return { bounds, categories };
}

class ResponseTooLargeError extends Error {}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('OpenStreetMap request canceled.', 'AbortError');
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
        reject(error instanceof Error ? error : new Error('OpenStreetMap request failed.'));
      },
    );
  });
}

async function readBoundedText(
  response: Response,
  limit: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!response.body) throw new Error('Missing response body');
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let length = 0;
  let text = '';
  try {
    for (;;) {
      const read = reader.read();
      const { done, value } = signal ? await withAbort(read, signal) : await read;
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new ResponseTooLargeError();
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    if (length > limit || signal?.aborted) await reader.cancel();
    reader.releaseLock();
  }
}

interface UpstreamResult<T> {
  value?: T;
  code?: GatewayErrorCode;
}

async function withUpstreamDeadline<T>(
  request: Request,
  fetcher: typeof fetch,
  timeoutMs: number,
  consume: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<UpstreamResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('OpenStreetMap request timed out.', 'TimeoutError')),
    timeoutMs,
  );
  try {
    const response = await withAbort(
      fetcher(new Request(request, { signal: controller.signal })),
      controller.signal,
    );
    return { value: await consume(response, controller.signal) };
  } catch (error) {
    return {
      code:
        error instanceof ResponseTooLargeError
          ? 'tile_too_dense'
          : error instanceof DOMException && error.name === 'TimeoutError'
            ? 'upstream_timeout'
            : 'upstream_busy',
    };
  } finally {
    clearTimeout(timer);
  }
}

export { handlePlaceSearch } from './place-gateway';

interface MirrorResult {
  elements?: OsmWayElement[];
  code?: GatewayErrorCode;
  retryAfter?: string;
}

const failurePriority: Record<GatewayErrorCode, number> = {
  invalid_request: 0,
  upstream_invalid: 1,
  upstream_busy: 2,
  upstream_timeout: 3,
  tile_too_dense: 4,
};

interface ConsumedMirrorResponse {
  ok: boolean;
  status: number;
  retryAfter?: string;
  text?: string;
}

async function consumeMirrorResponse(
  response: Response,
  signal: AbortSignal,
): Promise<ConsumedMirrorResponse> {
  const retryAfter = response.headers.get('retry-after') ?? undefined;
  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, status: response.status, retryAfter };
  }
  return {
    ok: true,
    status: response.status,
    retryAfter,
    text: await readBoundedText(response, MAX_OSM_RESPONSE_BYTES, signal),
  };
}

async function fetchMirror(
  endpoint: string,
  query: string,
  env: GatewayEnv,
  dependencies: GatewayDependencies,
): Promise<MirrorResult> {
  const upstreamRequest = new Request(endpoint, {
    method: 'POST',
    headers: new Headers({
      ...Object.fromEntries(identifiedHeaders(env.SITE_URL)),
      'content-type': 'text/plain;charset=UTF-8',
    }),
    body: query,
  });
  const result = await withUpstreamDeadline(
    upstreamRequest,
    dependencies.fetcher ?? fetch,
    dependencies.endpointTimeoutMs ?? OVERPASS_TIMEOUT_MS,
    consumeMirrorResponse,
  );
  if (!result.value) return { code: result.code ?? 'upstream_busy' };
  if (!result.value.ok) {
    return {
      code: BUSY_STATUSES.has(result.value.status) ? 'upstream_busy' : 'upstream_invalid',
      retryAfter: result.value.retryAfter,
    };
  }
  if (result.value.text === undefined) return { code: 'upstream_invalid' };
  let payload: unknown;
  try {
    payload = JSON.parse(result.value.text);
  } catch {
    return { code: 'upstream_invalid' };
  }
  const elements =
    payload && typeof payload === 'object'
      ? (payload as { elements?: unknown }).elements
      : undefined;
  try {
    return { elements: parseOsmElementsPayload(elements) };
  } catch {
    return { code: 'upstream_invalid' };
  }
}

function upstreamFailure(code: GatewayErrorCode, retryAfter?: string): Response {
  if (code === 'tile_too_dense') {
    return jsonError(code, 'This OpenStreetMap tile is too dense.', true, { status: 413 });
  }
  if (code === 'upstream_timeout') {
    return jsonError(code, 'OpenStreetMap did not answer in time.', true, { status: 504 });
  }
  if (code === 'upstream_invalid') {
    return jsonError(code, 'OpenStreetMap returned an invalid response.', false, { status: 502 });
  }
  return jsonError(code, 'OpenStreetMap is temporarily busy.', true, {
    status: 503,
    ...(retryAfter ? { retryAfter } : {}),
  });
}

export async function handleOpenStreetMapWays(
  request: Request,
  env: GatewayEnv,
  context: GatewayExecutionContext,
  dependencies: GatewayDependencies = {},
): Promise<Response> {
  const parsed = parseWaysRequest(request);
  if (!parsed) {
    return jsonError(
      'invalid_request',
      'Use ordered finite coordinates, supported categories, and an area no larger than 100 km².',
      false,
      { status: 400 },
    );
  }
  if (!(await allowed(env.OSM_TILE_LIMITER, clientKey(request)))) {
    return jsonError(
      'upstream_busy',
      'Too many OpenStreetMap tiles. Try again in a minute.',
      true,
      {
        status: 429,
        retryAfter: '60',
      },
    );
  }

  const cache = cacheFor(dependencies);
  const cached = await cache.match(request);
  if (cached) return cached;

  const query = buildOverpassQuery(parsed.bounds, parsed.categories);
  let lastCode: GatewayErrorCode | undefined;
  let retryAfter: string | undefined;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const result = await fetchMirror(endpoint, query, env, dependencies);
    if (!result.elements) {
      const code = result.code ?? 'upstream_busy';
      if (!lastCode || failurePriority[code] > failurePriority[lastCode]) lastCode = code;
      retryAfter = result.retryAfter ?? retryAfter;
      continue;
    }
    const response = Response.json(
      { elements: result.elements },
      { headers: { 'cache-control': `public, max-age=${OSM_CACHE_SECONDS}` } },
    );
    context.waitUntil(cache.put(request, response.clone()));
    return response;
  }

  return upstreamFailure(lastCode ?? 'upstream_busy', retryAfter);
}
