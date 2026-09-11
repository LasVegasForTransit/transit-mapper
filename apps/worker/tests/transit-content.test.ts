import {
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PublishedSystemRevisionResponse } from '@transitmapper/core/model/system-revision';
import type { ResolvedContentDescriptor } from '@transitmapper/core/network/resolved-content-reference';
import type { NetworkQueryResult } from '@transitmapper/core/network/result';
import type { CreateShareResponse } from '@transitmapper/core/share/contract';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { sha256Hex } from '../src/anonymous-resource';
import worker from '../src/index';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const worldQuery = {
  serviceTime: { kind: 'live' },
  modes: { kind: 'all' },
  filters: {},
  bounds: { kind: 'ordinary', west: -180, south: -90, east: 180, north: 90 },
  detailBand: 'district',
};

let systemSequence = 0;

async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function createShare(name?: string): Promise<CreateShareResponse> {
  systemSequence += 1;
  const response = await call(
    new Request('https://example.com/api/systems', {
      method: 'POST',
      body: JSON.stringify({ system: { name: name ?? `Transit fixture ${systemSequence}` } }),
    }),
  );
  expect(response.status).toBe(200);
  return response.json<CreateShareResponse>();
}

function publish(id: string, editToken: string | undefined): Promise<Response> {
  return call(
    new Request(`https://example.com/api/systems/${id}/revisions`, {
      method: 'POST',
      headers: editToken ? { 'x-edit-token': editToken } : {},
    }),
  );
}

async function publishedRevision(
  share: CreateShareResponse,
): Promise<PublishedSystemRevisionResponse> {
  const response = await publish(share.id, share.editToken);
  expect(response.status).toBe(200);
  return response.json<PublishedSystemRevisionResponse>();
}

function describeContent(reference: unknown): Promise<Response> {
  return call(
    new Request('https://example.com/api/transit/content-descriptions', {
      method: 'POST',
      body: JSON.stringify({ version: 'transit-network-v1', value: { reference } }),
    }),
  );
}

function networkPage(content: unknown, query: unknown = worldQuery): Promise<Response> {
  return call(
    new Request('https://example.com/api/transit/network-pages', {
      method: 'POST',
      body: JSON.stringify({ version: 'transit-network-v1', value: { content, query } }),
    }),
  );
}

/** A zero headway is a value schema v16 stores and schema v17 refuses, so a
 * document carrying one exercises the fallback rather than a parse failure. */
function unmigratableDocument(): string {
  const system = createEmptySystem(0) as unknown as Record<string, unknown>;
  system.id = 'authored-legacy';
  system.lines = [{ id: 'line-1', name: 'Line 1', serviceIds: ['svc-1'] }];
  system.services = [
    {
      id: 'svc-1',
      name: 'svc-1',
      modeId: 'bus',
      path: { id: 'svc-1', sections: [] },
      color: '#e4572e',
      frequencyMinutes: 0,
    },
  ];
  return JSON.stringify(system);
}

/** Written straight to storage: the share API parses what it is given, and
 * this document is one that only an older release could have stored. */
async function storeLegacyShare(id: string): Promise<void> {
  await env.DB.prepare('INSERT INTO systems (id, name, data, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, id, unmigratableDocument(), Date.now())
    .run();
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('publishing a System revision', () => {
  it('refuses to publish without the edit token that created the share', async () => {
    const share = await createShare();

    const anonymous = await publish(share.id, undefined);
    expect(anonymous.status).toBe(403);

    const wrongToken = await publish(share.id, 'f'.repeat(48));
    expect(wrongToken.status).toBe(403);
  });

  it('reports the original creation time when identical content is published twice', async () => {
    const share = await createShare();

    const first = await publishedRevision(share);
    const second = await publishedRevision(share);

    expect(second.systemRevisionId).toBe(first.systemRevisionId);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('gives differing semantic content a distinct revision and moves the head', async () => {
    const share = await createShare('Before the rename');
    const first = await publishedRevision(share);

    const renamed = await call(
      new Request(`https://example.com/api/systems/${share.id}`, {
        method: 'PATCH',
        headers: { 'x-edit-token': share.editToken ?? '' },
        body: JSON.stringify({ system: { name: 'After the rename' } }),
      }),
    );
    expect(renamed.status).toBe(200);

    const second = await publishedRevision(share);
    expect(second.systemRevisionId).not.toBe(first.systemRevisionId);

    // The earlier revision is still readable at its own identity: publishing
    // again must add history rather than replace it.
    const pinnedFirst = await describeContent({
      kind: 'transit-system',
      id: share.id,
      revision: { kind: 'pinned', systemRevisionId: first.systemRevisionId },
    });
    expect(pinnedFirst.status).toBe(200);

    const latest = await describeContent({
      kind: 'transit-system',
      id: share.id,
      revision: { kind: 'latest' },
    });
    const descriptor = (await latest.json<{ result: ResolvedContentDescriptor }>()).result;
    expect(descriptor.content).toMatchObject({
      kind: 'transit-system',
      revision: { kind: 'published', systemRevisionId: second.systemRevisionId },
    });
  });
});

describe('resolving System content', () => {
  it('answers for the working document until a revision is published', async () => {
    const share = await createShare();

    const response = await describeContent({
      kind: 'transit-system',
      id: share.id,
      revision: { kind: 'latest' },
    });
    expect(response.status).toBe(200);
    const descriptor = (await response.json<{ result: ResolvedContentDescriptor }>()).result;
    expect(descriptor.content).toMatchObject({
      kind: 'transit-system',
      revision: { kind: 'working' },
    });
  });

  it('resolves a pinned revision into a bounded network page', async () => {
    const share = await createShare();
    const revision = await publishedRevision(share);

    const response = await networkPage({
      kind: 'transit-system',
      id: share.id,
      revision: { kind: 'published', systemRevisionId: revision.systemRevisionId },
    });
    expect(response.status).toBe(200);
    const result = (await response.json<{ result: NetworkQueryResult }>()).result;
    expect(result.descriptor.content).toMatchObject({
      revision: { kind: 'published', systemRevisionId: revision.systemRevisionId },
    });
    expect(Array.isArray(result.chunks)).toBe(true);
  });

  it('refuses a revision belonging to a different System', async () => {
    const mine = await createShare();
    const theirs = await createShare();
    const theirRevision = await publishedRevision(theirs);

    const response = await describeContent({
      kind: 'transit-system',
      id: mine.id,
      revision: { kind: 'pinned', systemRevisionId: theirRevision.systemRevisionId },
    });
    expect(response.status).toBe(404);
    const body = await response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('revision-not-found');
  });

  it('reports an unknown System rather than an empty map', async () => {
    const response = await describeContent({
      kind: 'transit-system',
      id: 'nosuchid00',
      revision: { kind: 'latest' },
    });
    expect(response.status).toBe(404);
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe(
      'content-not-found',
    );
  });

  it('rejects an unsupported envelope version before reading the request value', async () => {
    const response = await call(
      new Request('https://example.com/api/transit/content-descriptions', {
        method: 'POST',
        body: JSON.stringify({ version: 'transit-network-v2', value: { reference: 'nonsense' } }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe(
      'unsupported-version',
    );
  });

  it('names the field that made a request invalid', async () => {
    const response = await describeContent({
      kind: 'transit-system',
      id: 'nosuchid00',
      revision: { kind: 'sideways' },
    });
    expect(response.status).toBe(400);
    const body = await response.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('invalid-request');
    expect(body.error.message).toContain('reference.revision.kind');
  });

  it('still describes a document schema v17 refuses, through the v16 provider', async () => {
    await storeLegacyShare('legacyread');

    const response = await describeContent({
      kind: 'transit-system',
      id: 'legacyread',
      revision: { kind: 'latest' },
    });

    // The person who authored this map must still be able to open it.
    expect(response.status).toBe(200);
    const descriptor = (await response.json<{ result: ResolvedContentDescriptor }>()).result;
    expect(descriptor.content).toMatchObject({
      kind: 'transit-system',
      id: 'legacyread',
      revision: { kind: 'working' },
    });
  });

  it('refuses to publish a document that cannot become a schema-v17 revision', async () => {
    await storeLegacyShare('legacypub1');
    // The share row carries no edit token, so authorise this one directly.
    await env.DB.prepare('UPDATE systems SET edit_token_hash = ? WHERE id = ?')
      .bind(await sha256Hex('publish-me'), 'legacypub1')
      .run();

    const response = await publish('legacypub1', 'publish-me');

    expect(response.status).toBe(422);
    const body = await response.json<{ issues: { code: string }[] }>();
    expect(body.issues.map((issue) => issue.code)).toContain('invalid-legacy-headway');

    const revisions = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM system_revisions WHERE system_id = ?',
    )
      .bind('legacypub1')
      .first<{ total: number }>();
    expect(revisions?.total).toBe(0);
  });

  it('refuses a working reference whose digest no longer matches the document', async () => {
    const share = await createShare();

    const response = await networkPage({
      kind: 'transit-system',
      id: share.id,
      revision: { kind: 'working', contentDigest: { algorithm: 'sha-256', value: '0'.repeat(64) } },
    });
    expect(response.status).toBe(409);
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe(
      'revision-conflict',
    );
  });
});
