// The share endpoints, exercised in real workerd against a real D1 with the
// production migrations applied.
//
// These are the first tests this Worker has ever had. It is the only
// component that touches D1, cookies, and caller-supplied bytes, so the
// cases below deliberately start at the untrusted-input boundary rather
// than at the happy path.
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
  applyD1Migrations,
  type D1Migration,
} from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from './index';

// The real bindings come from worker-configuration.d.ts, which
// `wrangler types` generates from wrangler.toml — so DB, ASSETS, SITE_URL
// and SHARE_CREATE_LIMITER are typed from the deployment config rather than
// restated here, and cannot drift from it.
//
// TEST_MIGRATIONS is the one binding that exists only under test: the
// migrations are read at config time and injected by miniflare.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

/** Drives the Worker the way a request does, including waitUntil work. */
async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function post(body: unknown): Request {
  return new Request('https://example.com/api/systems', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('POST /api/systems', () => {
  it('rejects a body that is not JSON', async () => {
    const response = await call(post('this is not json'));
    expect(response.status).toBe(400);
  });

  it('rejects a request with no system at all', async () => {
    const response = await call(post({}));
    expect(response.status).toBe(400);
  });

  it('says why it rejected', async () => {
    const response = await call(post('not json'));
    const payload = (await response.json()) as { error?: string };
    expect(payload.error).toMatch(/Invalid system/);
  });

  // Pinning current behaviour rather than asserting a preference. parseSystem
  // only rejects non-objects; anything object-shaped goes down the v2
  // migration path and normalises, so an arbitrary object is accepted and
  // stored. That is deliberate — the parser reads old formats tolerantly —
  // but it means this endpoint is a write primitive that accepts any object
  // under the size cap, bounded only by MAX_BODY_BYTES and the rate limiter.
  //
  // Written down here so that if it ever changes, it changes on purpose.
  it('accepts any object-shaped system, by design', async () => {
    const response = await call(post({ system: { nonsense: true } }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id?: string };
    expect(payload.id).toMatch(/^[A-Za-z0-9]{10}$/);
  });
});

describe('GET /api/systems/:id', () => {
  it('404s for an id that was never created', async () => {
    const response = await call(new Request('https://example.com/api/systems/doesnotexist'));
    expect(response.status).toBe(404);
  });

  it('404s rather than 500s for an id containing SQL metacharacters', async () => {
    const response = await call(
      new Request(`https://example.com/api/systems/${encodeURIComponent("' OR 1=1 --")}`),
    );
    expect(response.status).toBe(404);
  });
});

describe('the D1 schema the tests run against', () => {
  it('is the one the migrations produce, not a copy', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='systems'",
    ).all();
    expect(results).toHaveLength(1);
  });

  it('has the columns later migrations added', async () => {
    const { results } = await env.DB.prepare('PRAGMA table_info(systems)').all<{ name: string }>();
    const columns = results.map((r) => r.name);
    expect(columns).toContain('expires_at');
    expect(columns).toContain('preview');
  });
});
