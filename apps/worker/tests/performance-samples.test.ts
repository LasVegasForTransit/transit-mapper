import {
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformanceSample } from '@transitmapper/core/performance/contract';
import worker from '../src/index';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const SITE_URL = 'https://map.lasvegasfortransit.org';
const SAMPLE_URL = `${SITE_URL}/api/performance-samples`;

const VALID_SAMPLE: PerformanceSample = {
  schemaVersion: 1,
  buildId: '2026.08.13+2157fe8',
  surface: 'editor',
  phases: {
    documentResponseEndMs: 40,
    shellMountedMs: 60,
    bootstrapCompleteMs: 75,
    storageCompleteMs: 90,
    deserializeCompleteMs: null,
    systemCommittedMs: 95,
    firstSystemPaintMs: 300,
    interactiveMs: 325,
    networkIdleMs: 700,
    serviceWorkerReadyMs: null,
  },
  vitals: { lcpMs: 300, cls: 0.01, inpMs: null },
  bytes: {
    firstPartyAppBytes: 430_000,
    externalMapBytes: 120_000,
    documentDataBytes: 0,
    serviceWorkerBytes: 25_000,
    telemetryBytes: 900,
    totalBytes: 575_900,
  },
  cacheState: 'cold',
  serviceWorkerState: 'installing',
  deviceTier: 'standard',
  networkTier: 'fast',
  capabilityBits: 170,
};

interface CallOptions {
  env?: Partial<Env>;
}

async function call(request: Request, options: CallOptions = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const bindings = Object.assign({}, env, options.env);
  const response = await worker.fetch(request, bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

interface SampleRequestOptions {
  body?: BodyInit | null;
  headers?: HeadersInit;
}

function sampleRequest(options: SampleRequestOptions = {}): Request {
  const headers = new Headers({
    origin: SITE_URL,
    'content-type': 'application/json',
  });
  new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  return new Request(SAMPLE_URL, {
    method: 'POST',
    body: options.body === undefined ? JSON.stringify(VALID_SAMPLE) : options.body,
    headers,
  });
}

async function storedSamples(): Promise<Record<string, unknown>[]> {
  return (await env.DB.prepare('SELECT * FROM performance_samples').all()).results;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_performance_insert').run();
  await env.DB.prepare('DELETE FROM performance_samples').run();
});

describe('POST /api/performance-samples', () => {
  it('stores only the allowlisted sample and returns an empty uncacheable response', async () => {
    const response = await call(sampleRequest());

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.text()).toBe('');
    const [row] = await storedSamples();
    expect(row).toMatchObject({
      schema_version: 1,
      build_id: VALID_SAMPLE.buildId,
      surface: 'editor',
      shell_mounted_ms: 60,
      total_bytes: 575_900,
      cache_state: 'cold',
      capability_bits: 170,
    });
  });

  it.each([
    ['Global Privacy Control', { 'sec-gpc': '1' }],
    ['Do Not Track', { dnt: '1' }],
  ])('honors %s before reading the body', async (_name, privacyHeader) => {
    const request = sampleRequest({ headers: privacyHeader });

    const response = await call(request);

    expect(response.status).toBe(204);
    expect(request.bodyUsed).toBe(false);
    expect(await storedSamples()).toHaveLength(0);
  });

  it.each([
    ['a missing Origin', { origin: '' }, 403],
    ['a cross-origin caller', { origin: 'https://attacker.example' }, 403],
    ['a same-site caller', { 'sec-fetch-site': 'same-site' }, 403],
    ['a text body', { 'content-type': 'text/plain' }, 415],
    ['a compressed body', { 'content-encoding': 'gzip' }, 415],
  ])('rejects %s without storing it', async (_name, headers, status) => {
    const response = await call(sampleRequest({ headers }));

    expect(response.status).toBe(status);
    expect(await storedSamples()).toHaveLength(0);
  });

  it.each([
    ['malformed JSON', '{'],
    ['an extra URL field', JSON.stringify({ ...VALID_SAMPLE, url: '/s/private' })],
  ])('rejects %s', async (_name, body) => {
    const response = await call(sampleRequest({ body }));

    expect(response.status).toBe(400);
    expect(await storedSamples()).toHaveLength(0);
  });

  it('rejects a declared body above 8 KiB before reading it', async () => {
    const response = await call(
      sampleRequest({ headers: { 'content-length': '8193' }, body: JSON.stringify(VALID_SAMPLE) }),
    );

    expect(response.status).toBe(413);
    expect(await storedSamples()).toHaveLength(0);
  });

  it('stops a chunked body once its bytes exceed 8 KiB', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5000));
        controller.enqueue(new Uint8Array(4000));
        controller.close();
      },
    });
    const response = await call(sampleRequest({ body }));

    expect(response.status).toBe(413);
    expect(await storedSamples()).toHaveLength(0);
  });

  it('rejects bytes that are not valid UTF-8 JSON', async () => {
    const response = await call(sampleRequest({ body: new Uint8Array([0xff]) }));

    expect(response.status).toBe(400);
    expect(await storedSamples()).toHaveLength(0);
  });

  it('fails closed when a deployed request has no limiter binding', async () => {
    const response = await call(sampleRequest({ headers: { 'cf-connecting-ip': '192.0.2.10' } }), {
      env: { PERFORMANCE_SAMPLE_LIMITER: undefined },
    });

    expect(response.status).toBe(503);
    expect(await storedSamples()).toHaveLength(0);
  });

  it('returns 429 when the per-address limiter refuses the sample', async () => {
    const limit = vi.fn(() => Promise.resolve({ success: false }));
    const response = await call(sampleRequest({ headers: { 'cf-connecting-ip': '192.0.2.11' } }), {
      env: { PERFORMANCE_SAMPLE_LIMITER: { limit } },
    });

    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: '192.0.2.11' });
    expect(await storedSamples()).toHaveLength(0);
  });

  it('stores a sample when the per-address limiter allows it', async () => {
    const limit = vi.fn(() => Promise.resolve({ success: true }));
    const response = await call(sampleRequest({ headers: { 'cf-connecting-ip': '192.0.2.12' } }), {
      env: { PERFORMANCE_SAMPLE_LIMITER: { limit } },
    });

    expect(response.status).toBe(204);
    expect(await storedSamples()).toHaveLength(1);
  });

  it('fails closed when the platform limiter throws', async () => {
    const limit = vi.fn(() => Promise.reject(new Error('limiter unavailable')));
    const response = await call(sampleRequest({ headers: { 'cf-connecting-ip': '192.0.2.13' } }), {
      env: { PERFORMANCE_SAMPLE_LIMITER: { limit } },
    });

    expect(response.status).toBe(503);
    expect(await storedSamples()).toHaveLength(0);
  });

  it('isolates a telemetry storage failure from the closing page', async () => {
    await env.DB.prepare(
      `CREATE TRIGGER fail_performance_insert
       BEFORE INSERT ON performance_samples
       BEGIN SELECT RAISE(FAIL, 'forced insert failure'); END`,
    ).run();

    const response = await call(sampleRequest());

    expect(response.status).toBe(204);
    expect(await storedSamples()).toHaveLength(0);
    await env.DB.prepare('DROP TRIGGER fail_performance_insert').run();
  });
});

describe('the performance sample schema', () => {
  it('contains no column that can hold identity, content or location data', async () => {
    const { results } = await env.DB.prepare('PRAGMA table_info(performance_samples)').all<{
      name: string;
    }>();
    const columns = results.map((row) => row.name);

    expect(columns).not.toContain('id');
    expect(columns).not.toContain('raw_json');
    expect(columns).not.toContain('ip');
    expect(columns).not.toContain('user_agent');
    expect(columns).not.toContain('url');
    expect(columns).not.toContain('share_id');
    expect(columns).not.toContain('document_id');
    expect(columns).not.toContain('origin');
    expect(columns).not.toContain('coordinates');
    expect(columns).not.toContain('input');
  });

  it('enforces contract bounds and byte-total consistency on direct writes', async () => {
    const insert = (shellMountedMs: number, firstPartyBytes: number, totalBytes: number) =>
      env.DB.prepare(
        `INSERT INTO performance_samples (
          received_at, schema_version, build_id, surface, shell_mounted_ms,
          first_party_app_bytes, total_bytes, cache_state, service_worker_state,
          device_tier, network_tier, capability_bits
        ) VALUES (0, 1, 'direct-write', 'editor', ?, ?, ?, 'cold',
                  'controlled', 'standard', 'fast', 0)`,
      )
        .bind(shellMountedMs, firstPartyBytes, totalBytes)
        .run();

    await expect(insert(600_001, 10, 10)).rejects.toThrow();
    await expect(insert(100, 11, 10)).rejects.toThrow();
    expect(await storedSamples()).toHaveLength(0);
  });

  it('indexes raw comparisons by build, surface and receipt time', async () => {
    const { results } = await env.DB.prepare(
      'PRAGMA index_info(idx_performance_samples_build_surface_received)',
    ).all<{ name: string }>();

    expect(results.map((row) => row.name)).toEqual(['build_id', 'surface', 'received_at']);
  });
});
