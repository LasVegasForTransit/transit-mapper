import { migrateSchemaV16System } from '@transitmapper/core/model/schema-v17-system/migrate-v16';
import type { SchemaV16MigrationIssue } from '@transitmapper/core/model/schema-v17-system/migration-types';
import type { TransitSystem as SchemaV16TransitSystem } from '@transitmapper/core/model/system';
import {
  createSystemRevision,
  type PublishedSystemRevisionResponse,
} from '@transitmapper/core/model/system-revision';
import { SystemRevisionRepositoryError, publishSystemRevision } from './system-revisions';
import { sha256Hex } from './anonymous-resource';

/**
 * Publishing a System and backfilling the ones published before revisions
 * existed. Both turn one stored schema-v16 document into an immutable
 * schema-v17 revision, and both must refuse rather than guess when the
 * document cannot migrate.
 */

interface PublicationFailure {
  status: 409 | 422 | 500;
  error: string;
  issues?: readonly SchemaV16MigrationIssue[];
}

function migrationFailure(issues: readonly SchemaV16MigrationIssue[]): PublicationFailure {
  // 422 rather than 400: the request is well-formed, and the stored document
  // is the thing that cannot be expressed as a revision. A client cannot fix
  // this by resending.
  return {
    status: 422,
    error: 'This System cannot be published until its document migrates to schema v17.',
    issues,
  };
}

function repositoryFailure(error: SystemRevisionRepositoryError): PublicationFailure {
  if (error.code === 'revision-conflict') {
    return { status: 409, error: 'A different revision already holds that identity.' };
  }
  return { status: 500, error: 'The System revision could not be stored.' };
}

export async function publishSystemDocument(
  db: D1Database,
  systemId: string,
  system: SchemaV16TransitSystem,
): Promise<Response> {
  const migrated = migrateSchemaV16System(system);
  if (migrated.kind !== 'migrated') {
    const failure = migrationFailure(migrated.issues);
    return Response.json(failure, { status: failure.status });
  }

  let stored;
  try {
    stored = await publishSystemRevision(
      db,
      await createSystemRevision({
        systemId,
        createdAt: new Date().toISOString(),
        system: migrated.system,
      }),
    );
  } catch (error) {
    if (error instanceof SystemRevisionRepositoryError) {
      const failure = repositoryFailure(error);
      return Response.json(failure, { status: failure.status });
    }
    console.error(`Publishing System ${systemId} failed`, error);
    return Response.json({ error: 'The System could not be published.' }, { status: 500 });
  }

  const body: PublishedSystemRevisionResponse = {
    systemId: stored.systemId,
    systemRevisionId: stored.id,
    createdAt: stored.createdAt,
    contentDigest: stored.contentDigest,
  };
  // 200 rather than 201: republishing identical content creates nothing and
  // returns the revision that already existed, and one publication route
  // should not report two different statuses for the same resulting state.
  return Response.json(body, { status: 200 });
}

interface LegacySystemRow {
  id: string;
  data: string;
}

interface BackfillOutcome {
  systemId: string;
  resultKind: 'migrated' | 'invalid-legacy-system';
}

export interface BackfillReport {
  processed: readonly BackfillOutcome[];
  /** True when this run filled its batch, so a caller knows to run again
   * rather than concluding the backfill is finished. */
  moreRemaining: boolean;
}

/** Bounded so one invocation cannot exhaust the Worker's CPU budget on a
 * table that grows with every share ever published. */
const BACKFILL_BATCH_SIZE = 25;

interface BackfillResult {
  /** The `version` the stored document declared, when it declared a usable
   * one. Null records that the document did not say. */
  legacySchemaVersion: number | null;
  /** The revision this row produced, or null when it produced none. */
  revisionId: string | null;
}

async function recordBackfillOutcome(
  db: D1Database,
  row: LegacySystemRow,
  { legacySchemaVersion, revisionId }: BackfillResult,
): Promise<BackfillOutcome> {
  const resultKind = revisionId ? 'migrated' : 'invalid-legacy-system';
  await db
    .prepare(
      `INSERT OR REPLACE INTO system_revision_backfill_status (
         system_id, result_kind, legacy_schema_version,
         legacy_byte_digest_algorithm, legacy_byte_digest_value,
         revision_id, processed_at
       ) VALUES (?, ?, ?, 'sha-256', ?, ?, ?)`,
    )
    .bind(
      row.id,
      resultKind,
      legacySchemaVersion,
      // The digest covers the exact stored bytes, not the parsed value, so a
      // later run can tell a document that changed from one that was merely
      // reprocessed.
      await sha256Hex(row.data),
      revisionId,
      new Date().toISOString(),
    )
    .run();
  return { systemId: row.id, resultKind };
}

function legacySchemaVersion(parsed: unknown): number | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const version = (parsed as { version?: unknown }).version;
  return typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : null;
}

async function backfillOne(db: D1Database, row: LegacySystemRow): Promise<BackfillOutcome> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    return recordBackfillOutcome(db, row, { legacySchemaVersion: null, revisionId: null });
  }
  const version = legacySchemaVersion(parsed);
  try {
    const migrated = migrateSchemaV16System(parsed as SchemaV16TransitSystem);
    if (migrated.kind !== 'migrated')
      return await recordBackfillOutcome(db, row, {
        legacySchemaVersion: version,
        revisionId: null,
      });
    const stored = await publishSystemRevision(
      db,
      await createSystemRevision({
        systemId: row.id,
        createdAt: new Date().toISOString(),
        system: migrated.system,
      }),
    );
    return await recordBackfillOutcome(db, row, {
      legacySchemaVersion: version,
      revisionId: stored.id,
    });
  } catch (error) {
    // A document that throws somewhere inside migration is recorded as
    // terminal rather than retried forever. Nothing about it will change on a
    // later run, and a poison row must not block the rest of the batch.
    console.error(`Backfilling System ${row.id} failed`, error);
    return recordBackfillOutcome(db, row, { legacySchemaVersion: version, revisionId: null });
  }
}

/**
 * Gives already-published Systems an immutable revision.
 *
 * Only rows absent from the status table are considered, so a completed
 * backfill costs one query and reruns are safe. An invalid legacy document
 * records a terminal result instead of manufacturing a revision — a map that
 * cannot be expressed in schema v17 has no honest snapshot.
 */
export async function backfillSystemRevisions(db: D1Database): Promise<BackfillReport> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.data
       FROM systems s
       LEFT JOIN system_revision_backfill_status b ON b.system_id = s.id
       WHERE b.system_id IS NULL
       ORDER BY s.created_at
       LIMIT ?`,
    )
    .bind(BACKFILL_BATCH_SIZE)
    .all<LegacySystemRow>();

  const processed: BackfillOutcome[] = [];
  for (const row of results) processed.push(await backfillOne(db, row));
  return { processed, moreRemaining: results.length === BACKFILL_BATCH_SIZE };
}
