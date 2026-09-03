import {
  createSystemRevision,
  type SystemRevision,
} from '@transitmapper/core/model/system-revision';

type SystemRevisionRepositoryErrorCode =
  'invalid-revision' | 'revision-conflict' | 'corrupt-revision';

class SystemRevisionRepositoryError extends Error {
  readonly code: SystemRevisionRepositoryErrorCode;

  constructor(code: SystemRevisionRepositoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SystemRevisionRepositoryError';
    this.code = code;
  }
}

interface SystemRevisionRow {
  id: string;
  system_id: string;
  created_at: string;
  schema_version: number;
  content_digest_algorithm: string;
  content_digest_value: string;
  system_json: string;
}

const revisionColumns = `
  id, system_id, created_at, schema_version,
  content_digest_algorithm, content_digest_value, system_json
`;

async function canonicalCandidate(revision: SystemRevision): Promise<SystemRevision> {
  let canonical: SystemRevision;
  try {
    canonical = await createSystemRevision({
      systemId: revision.systemId,
      createdAt: revision.createdAt,
      system: revision.system,
    });
  } catch (error) {
    throw new SystemRevisionRepositoryError(
      'invalid-revision',
      'The System revision is not valid schema-v17 content.',
      { cause: error },
    );
  }
  if (
    revision.id !== canonical.id ||
    revision.contentDigest.value !== canonical.contentDigest.value
  ) {
    throw new SystemRevisionRepositoryError(
      'invalid-revision',
      'The System revision identity does not match its content.',
    );
  }
  return canonical;
}

async function rowById(db: D1Database, id: string): Promise<SystemRevisionRow | null> {
  return db
    .prepare(`SELECT ${revisionColumns} FROM system_revisions WHERE id = ?`)
    .bind(id)
    .first<SystemRevisionRow>();
}

async function revisionFromRow(row: SystemRevisionRow): Promise<SystemRevision> {
  try {
    if (
      row.schema_version !== 17 ||
      row.content_digest_algorithm !== 'sha-256' ||
      !/^[0-9a-f]{64}$/.test(row.content_digest_value)
    ) {
      throw new Error('Stored revision metadata is invalid.');
    }
    const revision = await createSystemRevision({
      systemId: row.system_id,
      createdAt: row.created_at,
      system: JSON.parse(row.system_json),
    });
    if (revision.id !== row.id || revision.contentDigest.value !== row.content_digest_value) {
      throw new Error('Stored revision identity does not match its content.');
    }
    return revision;
  } catch (error) {
    if (error instanceof SystemRevisionRepositoryError) throw error;
    throw new SystemRevisionRepositoryError(
      'corrupt-revision',
      'The stored System revision failed integrity validation.',
      { cause: error },
    );
  }
}

export async function getSystemRevision(
  db: D1Database,
  id: string,
): Promise<SystemRevision | null> {
  const row = await rowById(db, id);
  return row ? revisionFromRow(row) : null;
}

async function conflictingIdentityRow(
  db: D1Database,
  revision: SystemRevision,
): Promise<{ id: string } | null> {
  return db
    .prepare(
      `SELECT id FROM system_revisions
       WHERE system_id = ?
         AND content_digest_algorithm = ?
         AND content_digest_value = ?`,
    )
    .bind(revision.systemId, revision.contentDigest.algorithm, revision.contentDigest.value)
    .first<{ id: string }>();
}

function insertRevisionStatement(
  db: D1Database,
  revision: SystemRevision,
  systemJson: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO system_revisions (
         id, system_id, created_at, schema_version,
         content_digest_algorithm, content_digest_value, system_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      revision.id,
      revision.systemId,
      revision.createdAt,
      revision.schemaVersion,
      revision.contentDigest.algorithm,
      revision.contentDigest.value,
      systemJson,
    );
}

async function storedCandidate(
  db: D1Database,
  candidate: SystemRevision,
  systemJson: string,
): Promise<SystemRevision> {
  const stored = await getSystemRevision(db, candidate.id);
  if (!stored) {
    const conflict = await conflictingIdentityRow(db, candidate);
    throw new SystemRevisionRepositoryError(
      'revision-conflict',
      conflict
        ? 'The semantic System revision is stored under a different identity.'
        : 'The System revision insert did not produce a readable row.',
    );
  }
  if (
    stored.systemId !== candidate.systemId ||
    stored.contentDigest.value !== candidate.contentDigest.value ||
    JSON.stringify(stored.system) !== systemJson
  ) {
    throw new SystemRevisionRepositoryError(
      'revision-conflict',
      'The revision ID already names different immutable content.',
    );
  }
  return stored;
}

export async function insertSystemRevision(
  db: D1Database,
  revision: SystemRevision,
): Promise<SystemRevision> {
  const candidate = await canonicalCandidate(revision);
  const systemJson = JSON.stringify(candidate.system);
  await insertRevisionStatement(db, candidate, systemJson).run();
  return storedCandidate(db, candidate, systemJson);
}

export async function getCurrentSystemRevision(
  db: D1Database,
  systemId: string,
): Promise<SystemRevision | null> {
  const head = await db
    .prepare('SELECT revision_id FROM system_revision_heads WHERE system_id = ?')
    .bind(systemId)
    .first<{ revision_id: string }>();
  return head ? getSystemRevision(db, head.revision_id) : null;
}

export async function publishSystemRevision(
  db: D1Database,
  revision: SystemRevision,
): Promise<SystemRevision> {
  const candidate = await canonicalCandidate(revision);
  const systemJson = JSON.stringify(candidate.system);
  const updateHead = db
    .prepare(
      `INSERT INTO system_revision_heads (system_id, revision_id, updated_at)
       SELECT system_id, id, ?
       FROM system_revisions
       WHERE id = ?
         AND system_id = ?
         AND schema_version = 17
         AND content_digest_algorithm = ?
         AND content_digest_value = ?
         AND system_json = ?
       ON CONFLICT(system_id) DO UPDATE SET
         revision_id = excluded.revision_id,
         updated_at = excluded.updated_at`,
    )
    .bind(
      candidate.createdAt,
      candidate.id,
      candidate.systemId,
      candidate.contentDigest.algorithm,
      candidate.contentDigest.value,
      systemJson,
    );

  // The conditional head write prevents an ignored identity conflict from
  // replacing the last valid published revision.
  const [, headWrite] = await db.batch([
    insertRevisionStatement(db, candidate, systemJson),
    updateHead,
  ]);
  const stored = await storedCandidate(db, candidate, systemJson);
  if (headWrite.meta.changes !== 1) {
    throw new SystemRevisionRepositoryError(
      'revision-conflict',
      'The System revision was stored without becoming the current publication.',
    );
  }
  return stored;
}
