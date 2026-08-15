const PERFORMANCE_RAW_RETENTION_DAYS = 7;
const PERFORMANCE_AGGREGATE_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fixed server-side registry. These identifiers are SQL columns selected by
 * code, never labels supplied by a sample. */
const PERFORMANCE_METRICS = [
  'document_response_end_ms',
  'shell_mounted_ms',
  'bootstrap_complete_ms',
  'storage_complete_ms',
  'deserialize_complete_ms',
  'system_committed_ms',
  'first_system_paint_ms',
  'interactive_ms',
  'network_idle_ms',
  'service_worker_ready_ms',
  'lcp_ms',
  'cls',
  'inp_ms',
  'first_party_app_bytes',
  'external_map_bytes',
  'document_data_bytes',
  'service_worker_bytes',
  'telemetry_bytes',
  'total_bytes',
] as const;

type PerformanceMetric = (typeof PERFORMANCE_METRICS)[number];

interface PerformanceCohort {
  schema_version: number;
  build_id: string;
  surface: string;
  cache_state: string;
  service_worker_state: string;
  device_tier: string;
  network_tier: string;
  capability_bits: number;
  sample_count: number;
}

interface DaySnapshot {
  max_rowid: number | null;
  sample_count: number;
}

interface DayReadBoundary {
  dayStart: number;
  dayEnd: number;
  maxRowId: number;
  sampleCount: number;
}

type MetricValuesRow = Partial<Record<PerformanceMetric, number | null>>;

interface MetricSummary {
  count: number;
  min: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
  mean: number | null;
}

type MetricsSummary = Record<PerformanceMetric, MetricSummary>;

function utcDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function nearestRank(values: readonly number[], percentile: number): number {
  return values[Math.max(0, Math.ceil(percentile * values.length) - 1)];
}

function summarize(values: readonly number[]): MetricSummary {
  if (values.length === 0) {
    return { count: 0, min: null, p50: null, p75: null, p95: null, max: null, mean: null };
  }
  return {
    count: values.length,
    min: values[0],
    p50: nearestRank(values, 0.5),
    p75: nearestRank(values, 0.75),
    p95: nearestRank(values, 0.95),
    max: values[values.length - 1],
    mean: values.reduce((total, value) => total + value, 0) / values.length,
  };
}

const COHORT_WHERE = `received_at >= ? AND received_at < ? AND rowid <= ? AND
  schema_version = ? AND build_id = ? AND surface = ? AND cache_state = ? AND
  service_worker_state = ? AND device_tier = ? AND network_tier = ? AND
  capability_bits = ?`;

function bindCohort(
  statement: D1PreparedStatement,
  boundary: DayReadBoundary,
  cohort: PerformanceCohort,
): D1PreparedStatement {
  return statement.bind(
    boundary.dayStart,
    boundary.dayEnd,
    boundary.maxRowId,
    cohort.schema_version,
    cohort.build_id,
    cohort.surface,
    cohort.cache_state,
    cohort.service_worker_state,
    cohort.device_tier,
    cohort.network_tier,
    cohort.capability_bits,
  );
}

async function summarizeCohort(
  db: D1Database,
  boundary: DayReadBoundary,
  cohort: PerformanceCohort,
): Promise<MetricsSummary> {
  // Identifiers cannot be D1 parameters. This projection is safe because the
  // only interpolated names come from the fixed server-side registry above.
  const statement = db.prepare(
    `SELECT ${PERFORMANCE_METRICS.join(', ')} FROM performance_samples WHERE ${COHORT_WHERE}`,
  );
  const { results } = await bindCohort(statement, boundary, cohort).all<MetricValuesRow>();
  return Object.fromEntries(
    PERFORMANCE_METRICS.map((metric) => {
      const values = results
        .map((row) => row[metric])
        .filter((value): value is number => value !== null && value !== undefined)
        .sort((left, right) => left - right);
      return [metric, summarize(values)];
    }),
  ) as MetricsSummary;
}

async function dayIsComplete(db: D1Database, dayStart: number): Promise<boolean> {
  const completed = await db
    .prepare('SELECT 1 AS completed FROM performance_sample_aggregation_days WHERE day_start = ?')
    .bind(dayStart)
    .first<{ completed: number }>();
  return completed !== null;
}

function completionGuard(
  db: D1Database,
  boundary: DayReadBoundary,
  completedAt: number,
  ownerToken: string,
): D1PreparedStatement {
  // Accepted rows get a server receipt time, and only completed UTC days reach
  // this path. Once this first write starts, D1 serializes other writers; the
  // predicate therefore sees every row that can still belong to this day. The
  // close-day trigger rejects older writes after the marker commits. Producing
  // -1 deliberately trips the table CHECK and rolls back a stale batch.
  return db
    .prepare(
      `INSERT INTO performance_sample_aggregation_days
         (day_start, sample_count, completed_at, owner_token)
       SELECT ?, CASE WHEN (
         SELECT COUNT(*) FROM performance_samples
         WHERE received_at >= ? AND received_at < ? AND rowid <= ?
       ) = ? AND NOT EXISTS (
         SELECT 1 FROM performance_samples
         WHERE received_at >= ? AND received_at < ? AND rowid > ?
       ) THEN ? ELSE -1 END, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM performance_sample_aggregation_days WHERE day_start = ?
       )
       ON CONFLICT(day_start) DO NOTHING`,
    )
    .bind(
      boundary.dayStart,
      boundary.dayStart,
      boundary.dayEnd,
      boundary.maxRowId,
      boundary.sampleCount,
      boundary.dayStart,
      boundary.dayEnd,
      boundary.maxRowId,
      boundary.sampleCount,
      completedAt,
      ownerToken,
      boundary.dayStart,
    );
}

async function commitDaySnapshot(
  db: D1Database,
  boundary: DayReadBoundary,
  cohorts: readonly PerformanceCohort[],
  completedAt: number,
): Promise<void> {
  const ownerToken = crypto.randomUUID();
  const writes: D1PreparedStatement[] = [
    // This owned insert is both the concurrency lock and final marker. Every
    // following write checks the same token. A competing batch that finds a
    // marker inserts nothing and cannot delete or append the winner's rows.
    completionGuard(db, boundary, completedAt, ownerToken),
    db
      .prepare(
        `DELETE FROM performance_daily_aggregates
         WHERE day_start = ? AND EXISTS (
           SELECT 1 FROM performance_sample_aggregation_days
           WHERE day_start = ? AND owner_token = ?
         )`,
      )
      .bind(boundary.dayStart, boundary.dayStart, ownerToken),
  ];
  for (const cohort of cohorts) {
    const metrics = await summarizeCohort(db, boundary, cohort);
    writes.push(
      db
        .prepare(
          `INSERT INTO performance_daily_aggregates (
            day_start, schema_version, build_id, surface, cache_state,
            service_worker_state, device_tier, network_tier, capability_bits,
            sample_count, metrics_json, created_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM performance_sample_aggregation_days
              WHERE day_start = ? AND owner_token = ?
            )`,
        )
        .bind(
          boundary.dayStart,
          cohort.schema_version,
          cohort.build_id,
          cohort.surface,
          cohort.cache_state,
          cohort.service_worker_state,
          cohort.device_tier,
          cohort.network_tier,
          cohort.capability_bits,
          cohort.sample_count,
          JSON.stringify(metrics),
          completedAt,
          boundary.dayStart,
          ownerToken,
        ),
    );
  }
  // D1 executes a batch transactionally: either the guarded marker and the
  // complete UTC-day replacement commit together, or none of them do.
  await db.batch(writes);
}

async function aggregateDay(db: D1Database, dayStart: number, completedAt: number): Promise<void> {
  if (await dayIsComplete(db, dayStart)) return;

  const dayEnd = dayStart + DAY_MS;
  // performance_samples is append-only until a completed-day marker exists.
  // Pin every pre-transaction read to one rowid high-water so a sample that
  // arrives while summaries are being calculated cannot partially enter the
  // rollup. The transaction rejects this snapshot if such a row exists.
  const snapshot = await db
    .prepare(
      `SELECT MAX(rowid) AS max_rowid, COUNT(*) AS sample_count
       FROM performance_samples WHERE received_at >= ? AND received_at < ?`,
    )
    .bind(dayStart, dayEnd)
    .first<DaySnapshot>();
  const maxRowId = snapshot?.max_rowid;
  const sampleCount = snapshot?.sample_count;
  if (maxRowId === null || maxRowId === undefined || !sampleCount) return;

  const boundary = { dayStart, dayEnd, maxRowId, sampleCount };
  const { results: cohorts } = await db
    .prepare(
      `SELECT schema_version, build_id, surface, cache_state, service_worker_state,
              device_tier, network_tier, capability_bits, COUNT(*) AS sample_count
       FROM performance_samples
       WHERE received_at >= ? AND received_at < ? AND rowid <= ?
       GROUP BY schema_version, build_id, surface, cache_state, service_worker_state,
                device_tier, network_tier, capability_bits`,
    )
    .bind(dayStart, dayEnd, maxRowId)
    .all<PerformanceCohort>();

  await commitDaySnapshot(db, boundary, cohorts, completedAt);
}

async function aggregateCompleteDays(db: D1Database, now: number): Promise<void> {
  const currentDay = utcDayStart(now);
  const { results: days } = await db
    .prepare(
      `SELECT DISTINCT CAST(
         strftime('%s', received_at / 1000, 'unixepoch', 'start of day') AS INTEGER
       ) * 1000 AS day_start
       FROM performance_samples WHERE received_at < ? ORDER BY day_start`,
    )
    .bind(currentDay)
    .all<{ day_start: number }>();

  for (const { day_start: dayStart } of days) {
    await aggregateDay(db, dayStart, now);
  }
}

async function enforcePerformanceRetention(db: D1Database, now: number): Promise<void> {
  const rawBefore = utcDayStart(now) - PERFORMANCE_RAW_RETENTION_DAYS * DAY_MS;
  // A row is deleted only when its entire UTC day has a completion marker.
  // This keeps data for a failed rollup even when it has passed seven days.
  await db
    .prepare(
      `DELETE FROM performance_samples
       WHERE received_at < ? AND EXISTS (
         SELECT 1 FROM performance_sample_aggregation_days completed
         WHERE completed.day_start = CAST(
           strftime('%s', received_at / 1000, 'unixepoch', 'start of day') AS INTEGER
         ) * 1000
       )`,
    )
    .bind(rawBefore)
    .run();

  const aggregateBefore = utcDayStart(now) - PERFORMANCE_AGGREGATE_RETENTION_DAYS * DAY_MS;
  await db
    .prepare('DELETE FROM performance_daily_aggregates WHERE day_start < ?')
    .bind(aggregateBefore)
    .run();
  await db
    .prepare('DELETE FROM performance_sample_aggregation_days WHERE day_start < ?')
    .bind(aggregateBefore)
    .run();
}

/** Run every maintenance concern independently. Telemetry failures are
 * logged, but can never prevent the established expired-share cleanup. */
export async function runScheduledMaintenance(db: D1Database, now = Date.now()): Promise<void> {
  try {
    await aggregateCompleteDays(db, now);
    await enforcePerformanceRetention(db, now);
  } catch (error) {
    console.error('Performance sample maintenance failed', error);
  }

  try {
    await db
      .prepare('DELETE FROM systems WHERE expires_at IS NOT NULL AND expires_at < ?')
      .bind(now)
      .run();
  } catch (error) {
    console.error('Expired share cleanup failed', error);
    // This cleanup predates telemetry and used to reject the scheduled event.
    // Preserve that retry signal; only performance-sample failures are
    // deliberately isolated from established maintenance.
    throw error;
  }
}
