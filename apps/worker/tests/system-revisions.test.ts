import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { migrateSchemaV16System } from '@transitmapper/core/model/schema-v17-system/migrate-v16';
import {
  createSystemRevision,
  type SystemRevision,
} from '@transitmapper/core/model/system-revision';
import {
  getCurrentSystemRevision,
  getSystemRevision,
  insertSystemRevision,
  publishSystemRevision,
} from '../src/system-revisions';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

async function revision(
  createdAt = '2026-08-31T12:00:00.000Z',
  name = 'Authored system',
): Promise<SystemRevision> {
  const legacy = createEmptySystem(0);
  legacy.id = 'authored-system';
  legacy.name = name;
  const migrated = migrateSchemaV16System(legacy);
  if (migrated.kind !== 'migrated') throw new Error('Revision fixture did not migrate.');
  return createSystemRevision({
    systemId: 'published-system',
    createdAt,
    system: migrated.system,
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM system_revision_backfill_status'),
    env.DB.prepare('DELETE FROM system_revision_heads'),
    env.DB.prepare('DELETE FROM system_revisions'),
  ]);
});

describe('additive system revision storage', () => {
  it('inserts and retrieves one immutable authored revision', async () => {
    const candidate = await revision();

    await expect(insertSystemRevision(env.DB, candidate)).resolves.toEqual(candidate);
    await expect(getSystemRevision(env.DB, candidate.id)).resolves.toEqual(candidate);
  });

  it('publishes a revision as the current System snapshot', async () => {
    const candidate = await revision();

    await expect(publishSystemRevision(env.DB, candidate)).resolves.toEqual(candidate);
    await expect(getCurrentSystemRevision(env.DB, candidate.systemId)).resolves.toEqual(candidate);
  });

  it('moves the current pointer without mutating the prior revision', async () => {
    const first = await revision('2026-08-31T12:00:00.000Z');
    const second = await revision('2026-09-01T12:00:00.000Z', 'Revised authored system');

    await publishSystemRevision(env.DB, first);
    await publishSystemRevision(env.DB, second);

    await expect(getCurrentSystemRevision(env.DB, first.systemId)).resolves.toEqual(second);
    await expect(getSystemRevision(env.DB, first.id)).resolves.toEqual(first);
  });

  it('keeps the prior head when stored content conflicts with a publication', async () => {
    const first = await revision('2026-08-31T12:00:00.000Z');
    const conflicting = await revision('2026-09-01T12:00:00.000Z', 'Conflicting authored system');
    await publishSystemRevision(env.DB, first);
    await env.DB.prepare(
      `INSERT INTO system_revisions (
         id, system_id, created_at, schema_version,
         content_digest_algorithm, content_digest_value, system_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        conflicting.id,
        conflicting.systemId,
        conflicting.createdAt,
        conflicting.schemaVersion,
        conflicting.contentDigest.algorithm,
        conflicting.contentDigest.value,
        JSON.stringify(first.system),
      )
      .run();

    await expect(publishSystemRevision(env.DB, conflicting)).rejects.toMatchObject({
      code: 'corrupt-revision',
    });
    await expect(getCurrentSystemRevision(env.DB, first.systemId)).resolves.toEqual(first);
  });

  it('returns the first stored creation time for duplicate publication', async () => {
    const first = await revision('2026-08-31T12:00:00.000Z');
    const duplicate = await revision('2026-09-01T12:00:00.000Z');

    await publishSystemRevision(env.DB, first);
    const stored = await publishSystemRevision(env.DB, duplicate);
    const count = await env.DB.prepare('SELECT count(*) AS count FROM system_revisions').first<{
      count: number;
    }>();

    expect(stored.createdAt).toBe(first.createdAt);
    expect(count?.count).toBe(1);
  });

  it('rejects a forged mutation that reuses a revision ID', async () => {
    const original = await revision();
    await insertSystemRevision(env.DB, original);
    const forged: SystemRevision = {
      ...original,
      system: { ...original.system, name: 'Changed after hashing' },
    };

    await expect(insertSystemRevision(env.DB, forged)).rejects.toMatchObject({
      code: 'invalid-revision',
    });
    await expect(getSystemRevision(env.DB, original.id)).resolves.toEqual(original);
  });

  it('rejects direct updates to immutable revision rows', async () => {
    const original = await revision();
    await insertSystemRevision(env.DB, original);

    await expect(
      env.DB.prepare('UPDATE system_revisions SET created_at = ? WHERE id = ?')
        .bind('2026-09-01T12:00:00.000Z', original.id)
        .run(),
    ).rejects.toThrow();
  });

  it('returns null for an unknown revision ID', async () => {
    await expect(getSystemRevision(env.DB, 'f'.repeat(64))).resolves.toBeNull();
  });
});
