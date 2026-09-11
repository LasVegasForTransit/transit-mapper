import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { backfillSystemRevisions } from '../src/system-publication';
import { getCurrentSystemRevision } from '../src/system-revisions';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

interface BackfillStatusRow {
  result_kind: string;
  revision_id: string | null;
  legacy_schema_version: number | null;
  legacy_byte_digest_value: string;
}

async function storeLegacySystem(id: string, data: string): Promise<void> {
  await env.DB.prepare('INSERT INTO systems (id, name, data, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, id, data, Date.now())
    .run();
}

function legacyDocument(name: string): string {
  const system = createEmptySystem(0);
  system.id = `authored-${name}`;
  system.name = name;
  return JSON.stringify(system);
}

function backfillStatus(systemId: string): Promise<BackfillStatusRow | null> {
  return env.DB.prepare(
    `SELECT result_kind, revision_id, legacy_schema_version, legacy_byte_digest_value
     FROM system_revision_backfill_status WHERE system_id = ?`,
  )
    .bind(systemId)
    .first<BackfillStatusRow>();
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM system_revision_backfill_status'),
    env.DB.prepare('DELETE FROM system_revision_heads'),
    env.DB.prepare('DELETE FROM system_revisions'),
    env.DB.prepare('DELETE FROM systems'),
  ]);
});

describe('backfilling Systems published before revisions existed', () => {
  it('gives a legacy System a revision and points its head at it', async () => {
    await storeLegacySystem('legacysys01', legacyDocument('Legacy system'));

    const report = await backfillSystemRevisions(env.DB);

    expect(report.processed).toEqual([{ systemId: 'legacysys01', resultKind: 'migrated' }]);
    expect(report.moreRemaining).toBe(false);

    const head = await getCurrentSystemRevision(env.DB, 'legacysys01');
    expect(head?.systemId).toBe('legacysys01');

    const status = await backfillStatus('legacysys01');
    expect(status).toMatchObject({ result_kind: 'migrated', revision_id: head?.id });
    expect(status?.legacy_byte_digest_value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a terminal result for a document it cannot migrate, and creates no revision', async () => {
    await storeLegacySystem('brokensys1', '{"not":"a transit system"}');

    const report = await backfillSystemRevisions(env.DB);

    expect(report.processed).toEqual([
      { systemId: 'brokensys1', resultKind: 'invalid-legacy-system' },
    ]);
    await expect(backfillStatus('brokensys1')).resolves.toMatchObject({
      result_kind: 'invalid-legacy-system',
      revision_id: null,
    });
    // The point of recording the failure is that nothing was invented for it.
    const revisions = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM system_revisions WHERE system_id = ?',
    )
      .bind('brokensys1')
      .first<{ total: number }>();
    expect(revisions?.total).toBe(0);
  });

  it('considers only Systems it has not already processed', async () => {
    await storeLegacySystem('legacysys02', legacyDocument('First pass'));
    await backfillSystemRevisions(env.DB);

    await storeLegacySystem('legacysys03', legacyDocument('Second pass'));
    const second = await backfillSystemRevisions(env.DB);

    expect(second.processed).toEqual([{ systemId: 'legacysys03', resultKind: 'migrated' }]);
  });

  it('reports nothing to do once every System has been processed', async () => {
    await storeLegacySystem('legacysys04', legacyDocument('Only system'));
    await backfillSystemRevisions(env.DB);

    await expect(backfillSystemRevisions(env.DB)).resolves.toEqual({
      processed: [],
      moreRemaining: false,
    });
  });
});
