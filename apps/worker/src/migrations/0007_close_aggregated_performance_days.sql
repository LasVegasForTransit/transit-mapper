-- A completion marker closes its UTC day to further raw performance writes.
-- Aggregation and ingestion race safely because D1 serializes writers: if an
-- insert commits first, the aggregation high-water guard sees it and retries;
-- if the marker commits first, this trigger rejects the insert. Without this
-- database-level half of the invariant, a delayed or administrative write
-- carrying an older receipt time could create a row no rollup would revisit.
CREATE TRIGGER reject_performance_sample_for_completed_day
BEFORE INSERT ON performance_samples
WHEN EXISTS (
  SELECT 1
  FROM performance_sample_aggregation_days completed
  WHERE completed.day_start = CAST(
    strftime('%s', NEW.received_at / 1000, 'unixepoch', 'start of day') AS INTEGER
  ) * 1000
)
BEGIN
  SELECT RAISE(ABORT, 'performance sample UTC day is already aggregated');
END;
