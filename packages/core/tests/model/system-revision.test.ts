import { describe, expect, it } from 'vitest';
import { semanticDigest } from '../../src/encoding/semantic-digest';
import {
  createSystemRevision,
  systemRevisionId,
  systemRevisionContentDigest,
} from '../../src/model/system-revision';
import { migrateSchemaV16System } from '../../src/model/schema-v17-system/migrate-v16';
import type { ContentDigest } from '../../src/source/value-types';
import type { TransitSystem } from '../../src/transit/authored-system';
import { aSystem } from '../support/fixtures.test';

function authoredSystem(): TransitSystem {
  const result = migrateSchemaV16System(
    aSystem({ id: 'authored-system', name: 'Authored system', palette: ['#111111', '#eeeeee'] }),
  );
  if (result.kind !== 'migrated') throw new Error('Revision fixture did not migrate.');
  return result.system;
}

function unsigned32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function referenceFrame(parts: readonly string[]): Uint8Array {
  const encoded = parts.map((part) => new TextEncoder().encode(part));
  const length = 4 + encoded.reduce((total, part) => total + 4 + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  result.set(unsigned32(parts.length), offset);
  offset += 4;
  for (const part of encoded) {
    result.set(unsigned32(part.length), offset);
    offset += 4;
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function referenceSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('system revision identity', () => {
  it('hashes the parsed schema-v17 document with the transit-system preimage', async () => {
    const system = authoredSystem();

    await expect(systemRevisionContentDigest(system)).resolves.toEqual(
      await semanticDigest({
        encodingVersion: 'transit-system-json-v1',
        schemaVersion: 17,
        system,
      }),
    );
  });

  it('derives the revision ID from the exact framed identity tuple', async () => {
    const contentDigest: ContentDigest = { algorithm: 'sha-256', value: 'a'.repeat(64) };
    const expected = await referenceSha256(
      referenceFrame([
        'system-revision-v1',
        'published-system',
        contentDigest.algorithm,
        contentDigest.value,
      ]),
    );

    await expect(systemRevisionId('published-system', contentDigest)).resolves.toBe(expected);
  });

  it('keeps revision identity independent from publication time', async () => {
    const first = await createSystemRevision({
      systemId: 'published-system',
      createdAt: '2026-08-31T12:00:00.000Z',
      system: authoredSystem(),
    });
    const second = await createSystemRevision({
      systemId: 'published-system',
      createdAt: '2026-09-01T12:00:00.000Z',
      system: authoredSystem(),
    });

    expect(second.id).toBe(first.id);
    expect(second.contentDigest).toEqual(first.contentDigest);
    expect(first.createdAt).not.toBe(second.createdAt);
  });

  it('keeps the storage-root identity separate from the authored document ID', async () => {
    const revision = await createSystemRevision({
      systemId: 'published-system',
      createdAt: '2026-08-31T12:00:00.000Z',
      system: authoredSystem(),
    });

    expect(revision.systemId).toBe('published-system');
    expect(revision.system.id).toBe('authored-system');
  });

  it('preserves meaningful array order in the content digest', async () => {
    const first = authoredSystem();
    const second = authoredSystem();
    second.palette.reverse();

    await expect(systemRevisionContentDigest(first)).resolves.not.toEqual(
      await systemRevisionContentDigest(second),
    );
  });

  it('rejects a document that the schema-v17 parser cannot reconstruct', async () => {
    const system = { ...authoredSystem(), rendererState: { selectedLayer: 'routes' } };

    await expect(systemRevisionContentDigest(system)).rejects.toThrow();
  });
});
