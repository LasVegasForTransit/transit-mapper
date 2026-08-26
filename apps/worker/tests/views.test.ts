import {
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_VIEW_API_BODY_BYTES, type CreateViewResponse } from '@transitmapper/views';
import worker from '../src/index';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const viewState = {
  schemaVersion: 1 as const,
  camera: { center: [-115.17, 36.14] as [number, number], zoom: 11 },
  representationId: 'network',
  filters: { modes: ['bus'], landmarks: true },
};

let systemSequence = 0;

async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function createSharedSystem(): Promise<string> {
  systemSequence += 1;
  const response = await call(
    new Request('https://example.com/api/systems', {
      method: 'POST',
      body: JSON.stringify({ system: { name: `View fixture ${systemSequence}` } }),
    }),
  );
  const payload = await response.json<{ id: string }>();
  return payload.id;
}

async function createView(
  sharedSystemId: string,
  title = 'Downtown buses',
): Promise<CreateViewResponse> {
  const response = await call(
    new Request('https://example.com/api/v1/views', {
      method: 'POST',
      body: JSON.stringify({ title, sharedSystemId, state: viewState }),
    }),
  );
  expect(response.status).toBe(201);
  return response.json<CreateViewResponse>();
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('published View API', () => {
  it('creates a public View and returns its edit token only in the creation response', async () => {
    const sharedSystemId = await createSharedSystem();
    const created = await createView(sharedSystemId);

    expect(created).toMatchObject({
      view: {
        schemaVersion: 1,
        title: 'Downtown buses',
        map: { kind: 'shared-system', id: sharedSystemId },
        state: viewState,
      },
    });
    expect(created.view.id).toMatch(/^[0-9a-z]{10}$/);
    expect(created.editToken).toMatch(/^[0-9a-f]{48}$/);

    const stored = await env.DB.prepare('SELECT edit_token_hash FROM views WHERE id = ?')
      .bind(created.view.id)
      .first<{ edit_token_hash: string }>();
    expect(stored?.edit_token_hash).not.toBe(created.editToken);

    const response = await call(new Request(`https://example.com/api/v1/views/${created.view.id}`));
    expect(response.status).toBe(200);
    const fetched = await response.json<Record<string, unknown>>();
    expect(fetched).not.toHaveProperty('editToken');
    expect(fetched).toMatchObject({ view: created.view });
  });

  it('creates distinct Views for identical state', async () => {
    const sharedSystemId = await createSharedSystem();
    const first = await createView(sharedSystemId, 'First publication');
    const second = await createView(sharedSystemId, 'First publication');

    expect(second.view.id).not.toBe(first.view.id);
  });

  it('keeps both an active View and its referenced system from expiring', async () => {
    const sharedSystemId = await createSharedSystem();
    const created = await createView(sharedSystemId);
    const oldExpiry = Date.now() + 2 * 24 * 60 * 60 * 1000;
    await env.DB.batch([
      env.DB.prepare('UPDATE views SET expires_at = ? WHERE id = ?').bind(
        oldExpiry,
        created.view.id,
      ),
      env.DB.prepare('UPDATE systems SET expires_at = ? WHERE id = ?').bind(
        oldExpiry,
        sharedSystemId,
      ),
    ]);

    const response = await call(new Request(`https://example.com/api/v1/views/${created.view.id}`));
    expect(response.status).toBe(200);

    const view = await env.DB.prepare('SELECT expires_at FROM views WHERE id = ?')
      .bind(created.view.id)
      .first<{ expires_at: number }>();
    const system = await env.DB.prepare('SELECT expires_at FROM systems WHERE id = ?')
      .bind(sharedSystemId)
      .first<{ expires_at: number }>();
    expect(view?.expires_at).toBeGreaterThan(oldExpiry);
    expect(system?.expires_at).toBeGreaterThan(oldExpiry);
  });

  it('rejects invalid, oversized, and dangling View requests', async () => {
    const localSelection = await call(
      new Request('https://example.com/api/v1/views', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Private selection',
          sharedSystemId: await createSharedSystem(),
          state: {
            ...viewState,
            selection: { source: 'local-document', kind: 'stop', id: 'stop-1' },
          },
        }),
      }),
    );
    expect(localSelection.status).toBe(400);

    const oversized = await call(
      new Request('https://example.com/api/v1/views', {
        method: 'POST',
        body: 'x'.repeat(MAX_VIEW_API_BODY_BYTES + 1),
      }),
    );
    expect(oversized.status).toBe(413);

    const dangling = await call(
      new Request('https://example.com/api/v1/views', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Missing map',
          sharedSystemId: 'doesnotexist',
          state: viewState,
        }),
      }),
    );
    expect(dangling.status).toBe(404);
  });

  it('updates mutable fields only when the caller presents the edit token', async () => {
    const created = await createView(await createSharedSystem());
    const url = `https://example.com/api/v1/views/${created.view.id}`;

    const unauthorized = await call(
      new Request(url, {
        method: 'PATCH',
        headers: { 'x-edit-token': 'wrong' },
        body: JSON.stringify({ title: 'Unauthorized title' }),
      }),
    );
    expect(unauthorized.status).toBe(403);

    const immutable = await call(
      new Request(url, {
        method: 'PATCH',
        headers: { 'x-edit-token': created.editToken },
        body: JSON.stringify({ sharedSystemId: 'replacement' }),
      }),
    );
    expect(immutable.status).toBe(400);

    const response = await call(
      new Request(url, {
        method: 'PATCH',
        headers: { 'x-edit-token': created.editToken },
        body: JSON.stringify({ title: 'The Strip at night', description: null }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      view: { id: created.view.id, title: 'The Strip at night' },
    });
  });

  it('removes a View whose referenced shared system no longer exists', async () => {
    const sharedSystemId = await createSharedSystem();
    const created = await createView(sharedSystemId);
    await env.DB.prepare('DELETE FROM systems WHERE id = ?').bind(sharedSystemId).run();

    const response = await call(new Request(`https://example.com/api/v1/views/${created.view.id}`));
    expect(response.status).toBe(404);
    expect(
      await env.DB.prepare('SELECT id FROM views WHERE id = ?').bind(created.view.id).first(),
    ).toBeNull();
  });

  it('requires the edit token to delete a View', async () => {
    const created = await createView(await createSharedSystem());
    const url = `https://example.com/api/v1/views/${created.view.id}`;

    expect((await call(new Request(url, { method: 'DELETE' }))).status).toBe(403);
    expect(
      (
        await call(
          new Request(url, {
            method: 'DELETE',
            headers: { 'x-edit-token': created.editToken },
          }),
        )
      ).status,
    ).toBe(204);
    expect((await call(new Request(url))).status).toBe(404);
  });

  it('publishes oEmbed metadata that opens the named View embed', async () => {
    const sharedSystemId = await createSharedSystem();
    const created = await createView(sharedSystemId, 'Buses across the valley');
    const target = encodeURIComponent(`https://map.lasvegasfortransit.org/v/${created.view.id}`);

    const response = await call(
      new Request(`https://example.com/api/oembed?url=${target}&format=json`),
    );
    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('title' in payload) ||
      !('thumbnail_url' in payload) ||
      !('html' in payload)
    ) {
      throw new TypeError('Expected an oEmbed response object.');
    }
    expect(payload.title).toBe('Buses across the valley');
    expect(payload.thumbnail_url).toBe(
      `https://map.lasvegasfortransit.org/s/${sharedSystemId}/preview.png`,
    );
    expect(payload.html).toContain(
      `src="https://map.lasvegasfortransit.org/embed/${created.view.id}"`,
    );
  });

  it('allows framing only for the named View embed route', async () => {
    const created = await createView(await createSharedSystem());

    const embed = await call(new Request(`https://example.com/embed/${created.view.id}`));
    expect(embed.headers.get('content-security-policy')).toContain('frame-ancestors *');
    expect(embed.headers.has('x-frame-options')).toBe(false);

    const viewer = await call(new Request(`https://example.com/v/${created.view.id}`));
    expect(viewer.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});
