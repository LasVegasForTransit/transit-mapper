-- A rollup batch owns its completion marker with an ephemeral random token.
-- Competing batches use that token to gate every aggregate write, making the
-- loser a transactional no-op instead of depending on D1's formatted UNIQUE
-- error text. Existing completed days remain valid with a null owner.
ALTER TABLE performance_sample_aggregation_days
ADD COLUMN owner_token TEXT
CHECK (owner_token IS NULL OR length(owner_token) BETWEEN 1 AND 128);
