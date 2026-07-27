-- Lets a create request that exactly matches an existing, still-live share
-- reuse it instead of minting a fresh row and a fresh URL — without this,
-- reopening the share dialog on an unchanged system created a new row (and a
-- new /s/:id link) on every single open.
--
-- Not UNIQUE: a benign race between two concurrent creates of the same
-- content is allowed to produce two rows rather than have the losing request
-- fail outright. The extra row is harmless — it expires and gets swept like
-- any other.
ALTER TABLE systems ADD COLUMN content_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_systems_content_hash ON systems (content_hash);
