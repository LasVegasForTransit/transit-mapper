CREATE TABLE views (
  -- The Worker generates an opaque public identifier.
  id TEXT PRIMARY KEY,
  -- This version covers the row shape and the JSON state contract.
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  -- The title and description are untrusted display text.
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 500),
  -- A View points at the existing mutable shared-system resource. The lack of
  -- a foreign key lets existing share cleanup remain independent.
  shared_system_id TEXT NOT NULL,
  -- The Worker stores only validated MapViewStateV1 JSON here.
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  -- All timestamps use Unix milliseconds, as the systems table does.
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  -- NULL means permanent. Version 1 anonymous rows receive an expiry.
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at >= created_at),
  -- The Worker stores a token hash. It never stores or returns the token again.
  edit_token_hash TEXT
);

CREATE INDEX idx_views_shared_system_id ON views (shared_system_id);
CREATE INDEX idx_views_expires_at ON views (expires_at);
