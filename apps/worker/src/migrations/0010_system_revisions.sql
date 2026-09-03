-- Immutable authored snapshots live beside the mutable compatibility table.
-- This migration creates no rows and does not interpret existing system JSON.
CREATE TABLE system_revisions (
  -- Revision IDs are the lowercase SHA-256 digest of system-revision-v1.
  id TEXT PRIMARY KEY
    CHECK (length(id) = 64 AND id NOT GLOB '*[^0-9a-f]*'),
  -- The owning published System resource. It is intentionally not a foreign
  -- key to systems because compatibility-row expiry must not erase history.
  system_id TEXT NOT NULL CHECK (length(trim(system_id)) > 0),
  -- The first successful insertion time. Duplicate publication keeps it.
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version = 17),
  content_digest_algorithm TEXT NOT NULL CHECK (content_digest_algorithm = 'sha-256'),
  content_digest_value TEXT NOT NULL CHECK (
    length(content_digest_value) = 64 AND
    content_digest_value NOT GLOB '*[^0-9a-f]*'
  ),
  -- Only the parsed portable schema-v17 document enters this JSON column.
  system_json TEXT NOT NULL CHECK (
    json_valid(system_json) AND json_type(system_json) = 'object'
  ),
  UNIQUE (system_id, content_digest_algorithm, content_digest_value)
) WITHOUT ROWID;

CREATE INDEX idx_system_revisions_system_id
  ON system_revisions (system_id, created_at);

-- Repository code has no update method, and this trigger keeps direct D1
-- callers from bypassing that boundary. Retention may still delete an
-- unreferenced revision after it checks every dependency.
CREATE TRIGGER reject_system_revision_update
BEFORE UPDATE ON system_revisions
BEGIN
  SELECT RAISE(ABORT, 'system revisions are immutable');
END;

-- One mutable pointer selects the current immutable revision for a System.
CREATE TABLE system_revision_heads (
  system_id TEXT PRIMARY KEY CHECK (length(trim(system_id)) > 0),
  revision_id TEXT NOT NULL UNIQUE
    REFERENCES system_revisions(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0)
) WITHOUT ROWID;

-- A bounded backfill processes only compatibility rows absent from this
-- table. Invalid legacy JSON records a terminal result without manufacturing
-- a revision, while a successful row retains the exact legacy byte digest.
CREATE TABLE system_revision_backfill_status (
  system_id TEXT PRIMARY KEY CHECK (length(trim(system_id)) > 0),
  result_kind TEXT NOT NULL
    CHECK (result_kind IN ('migrated', 'invalid-legacy-system')),
  legacy_schema_version INTEGER
    CHECK (legacy_schema_version IS NULL OR legacy_schema_version > 0),
  legacy_byte_digest_algorithm TEXT NOT NULL
    CHECK (legacy_byte_digest_algorithm = 'sha-256'),
  legacy_byte_digest_value TEXT NOT NULL CHECK (
    length(legacy_byte_digest_value) = 64 AND
    legacy_byte_digest_value NOT GLOB '*[^0-9a-f]*'
  ),
  revision_id TEXT REFERENCES system_revisions(id) ON DELETE RESTRICT,
  processed_at TEXT NOT NULL CHECK (length(trim(processed_at)) > 0),
  CHECK (
    (result_kind = 'migrated' AND revision_id IS NOT NULL) OR
    (result_kind = 'invalid-legacy-system' AND revision_id IS NULL)
  )
) WITHOUT ROWID;
