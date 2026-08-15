import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runScheduledMaintenance } from '../src/performance-maintenance';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const AUGUST_10 = Date.UTC(2026, 7, 10);

interface InsertSampleOptions {
  receivedAt: number;
  buildId?: string;
  surface?: 'editor' | 'share' | 'embed';
  lcpMs?: number | null;
  totalBytes?: number;
  cacheState?: 'cold' | 'warm' | 'mixed' | 'unknown';
  capabilityBits?: number;
}

async function insertSample(options: InsertSampleOptions): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO performance_samples (
      received_at, schema_version, build_id, surface, lcp_ms, total_bytes,
      cache_state, service_worker_state, device_tier, network_tier, capability_bits
    ) VALUES (?, 1, ?, ?, ?, ?, ?, 'controlled', 'standard', 'fast', ?)`,
  )
    .bind(
      options.receivedAt,
      options.buildId ?? 'build-a',
      options.surface ?? 'editor',
      options.lcpMs ?? null,
      options.totalBytes ?? 100,
      options.cacheState ?? 'cold',
      options.capabilityBits ?? 1,
    )
    .run();
}

interface DailyAggregateRow {
  day_start: number;
  build_id: string;
  surface: string;
  sample_count: number;
  metrics_json: string;
  created_at: number;
}

interface MetricSummary {
  count: number;
  min: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
  mean: number | null;
}

async function aggregateRows(): Promise<DailyAggregateRow[]> {
  return (
    await env.DB.prepare(
      `SELECT day_start, build_id, surface, sample_count, metrics_json, created_at
       FROM performance_daily_aggregates
       ORDER BY day_start, build_id, surface`,
    ).all<DailyAggregateRow>()
  ).results;
}

async function insertSystem(id: string, expiresAt: number | null): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO systems (id, name, data, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, id, '{}', AUGUST_10, expiresAt)
    .run();
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_performance_rollup').run();
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_performance_rollup_completion').run();
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_share_cleanup').run();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM performance_sample_aggregation_days'),
    env.DB.prepare('DELETE FROM performance_daily_aggregates'),
    env.DB.prepare('DELETE FROM performance_samples'),
    env.DB.prepare('DELETE FROM systems'),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('daily performance aggregation', () => {
  it('groups cohorts and computes nearest-rank percentiles from fixed metrics', async () => {
    for (const [index, lcpMs] of [10, 20, 30, 40, 100].entries()) {
      await insertSample({
        receivedAt: AUGUST_10 + index,
        lcpMs,
        totalBytes: lcpMs * 10,
      });
    }
    await insertSample({
      receivedAt: AUGUST_10 + 10,
      buildId: 'build-b',
      surface: 'share',
      lcpMs: 12,
      totalBytes: 50,
    });

    await runScheduledMaintenance(env.DB, AUGUST_10 + 2 * DAY_MS);

    const rows = await aggregateRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      day_start: AUGUST_10,
      build_id: 'build-a',
      surface: 'editor',
      sample_count: 5,
    });
    const metrics = JSON.parse(rows[0].metrics_json) as Record<string, MetricSummary>;
    expect(Object.keys(metrics)).toHaveLength(19);
    expect(metrics.lcp_ms).toEqual({
      count: 5,
      min: 10,
      p50: 30,
      p75: 40,
      p95: 100,
      max: 100,
      mean: 40,
    });
    expect(metrics.deserialize_complete_ms).toEqual({
      count: 0,
      min: null,
      p50: null,
      p75: null,
      p95: null,
      max: null,
      mean: null,
    });
  });

  it('is idempotent when the same completed day is scheduled again', async () => {
    await insertSample({ receivedAt: AUGUST_10, lcpMs: 100 });

    await runScheduledMaintenance(env.DB, AUGUST_10 + DAY_MS);
    const first = await aggregateRows();
    await runScheduledMaintenance(env.DB, AUGUST_10 + DAY_MS + 1000);

    expect(await aggregateRows()).toEqual(first);
    const markerCount = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM performance_sample_aggregation_days',
    ).first<{ count: number }>();
    expect(markerCount?.count).toBe(1);
  });

  it('makes an overlapping D1 rollup loser a silent transactional no-op', async () => {
    await insertSample({ receivedAt: AUGUST_10, lcpMs: 100 });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await Promise.all([
      runScheduledMaintenance(env.DB, AUGUST_10 + DAY_MS),
      runScheduledMaintenance(env.DB, AUGUST_10 + DAY_MS + 1),
    ]);

    expect(await aggregateRows()).toEqual([
      expect.objectContaining({ day_start: AUGUST_10, sample_count: 1 }),
    ]);
    const markers = await env.DB.prepare(
      'SELECT day_start, owner_token FROM performance_sample_aggregation_days',
    ).all<{ day_start: number; owner_token: string }>();
    expect(markers.results).toHaveLength(1);
    expect(markers.results[0]?.day_start).toBe(AUGUST_10);
    expect(markers.results[0]?.owner_token).toMatch(/^[0-9a-f-]+$/i);
    expect(error).not.toHaveBeenCalled();
  });

  it('never loses a sample racing the D1 close-day transaction', async () => {
    await insertSample({ receivedAt: AUGUST_10 + 1, lcpMs: 100 });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const [, insertion] = await Promise.allSettled([
      runScheduledMaintenance(env.DB, AUGUST_10 + DAY_MS + 1),
      insertSample({ receivedAt: AUGUST_10 + 2, lcpMs: 200 }),
    ]);
    await runScheduledMaintenance(env.DB, AUGUST_10 + DAY_MS + 2);

    const stored = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM performance_samples WHERE received_at >= ? AND received_at < ?',
    )
      .bind(AUGUST_10, AUGUST_10 + DAY_MS)
      .first<{ count: number }>();
    expect((await aggregateRows())[0]?.sample_count).toBe(stored?.count);
    if (insertion.status === 'rejected') {
      expect(String(insertion.reason)).toContain(
        'performance sample UTC day is already aggregated',
      );
    }
  });

  it('rejects a sample inserted after its UTC day has completed aggregation', async () => {
    await insertSample({ receivedAt: AUGUST_10 + 1, lcpMs: 100 });
    await runScheduledMaintenance(env.DB, AUGUST_10 + DAY_MS + 1);

    await expect(insertSample({ receivedAt: AUGUST_10 + 2, lcpMs: 200 })).rejects.toThrow(
      /performance sample UTC day is already aggregated/,
    );

    const stored = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM performance_samples WHERE received_at >= ? AND received_at < ?',
    )
      .bind(AUGUST_10, AUGUST_10 + DAY_MS)
      .first<{ count: number }>();
    expect(stored?.count).toBe(1);
  });

  it('catches up every complete UTC day but leaves the current day raw', async () => {
    await insertSample({ receivedAt: AUGUST_10 + 1 });
    await insertSample({ receivedAt: AUGUST_10 + DAY_MS + 1 });
    await insertSample({ receivedAt: AUGUST_10 + 2 * DAY_MS + 1 });

    await runScheduledMaintenance(env.DB, AUGUST_10 + 2 * DAY_MS + 1000);

    expect((await aggregateRows()).map((row) => row.day_start)).toEqual([
      AUGUST_10,
      AUGUST_10 + DAY_MS,
    ]);
    const markers = await env.DB.prepare(
      'SELECT day_start FROM performance_sample_aggregation_days ORDER BY day_start',
    ).all<{ day_start: number }>();
    expect(markers.results.map((row) => row.day_start)).toEqual([AUGUST_10, AUGUST_10 + DAY_MS]);
  });

  it('retains raw rows for seven days and aggregates for ninety days', async () => {
    const now = AUGUST_10 + 100 * DAY_MS;
    const oldDay = now - 91 * DAY_MS;
    const recentDay = now - 5 * DAY_MS;
    await insertSample({ receivedAt: oldDay + 1, buildId: 'old-build' });
    await insertSample({ receivedAt: recentDay + 1, buildId: 'recent-build' });

    await runScheduledMaintenance(env.DB, now);

    const raw = await env.DB.prepare(
      'SELECT build_id FROM performance_samples ORDER BY build_id',
    ).all<{ build_id: string }>();
    expect(raw.results.map((row) => row.build_id)).toEqual(['recent-build']);
    expect((await aggregateRows()).map((row) => row.build_id)).toEqual(['recent-build']);
  });

  it('atomically replaces a complete day across failure and retry', async () => {
    await insertSample({ receivedAt: AUGUST_10, buildId: 'build-a', lcpMs: 100 });
    await insertSample({
      receivedAt: AUGUST_10 + 1,
      buildId: 'build-b',
      surface: 'share',
      lcpMs: 200,
    });
    await env.DB.prepare(
      `INSERT INTO performance_daily_aggregates (
        day_start, schema_version, build_id, surface, cache_state,
        service_worker_state, device_tier, network_tier, capability_bits,
        sample_count, metrics_json, created_at
      ) VALUES (?, 1, 'build-a', 'editor', 'cold', 'controlled', 'standard', 'fast', 1,
                99, '{}', ?),
               (?, 1, 'stale-build', 'embed', 'cold', 'controlled', 'standard', 'fast', 1,
                1, '{}', ?)`,
    )
      .bind(AUGUST_10, AUGUST_10 - 1, AUGUST_10, AUGUST_10 - 1)
      .run();
    const staleAggregates: DailyAggregateRow[] = [
      {
        day_start: AUGUST_10,
        build_id: 'build-a',
        surface: 'editor',
        sample_count: 99,
        metrics_json: '{}',
        created_at: AUGUST_10 - 1,
      },
      {
        day_start: AUGUST_10,
        build_id: 'stale-build',
        surface: 'embed',
        sample_count: 1,
        metrics_json: '{}',
        created_at: AUGUST_10 - 1,
      },
    ];
    await env.DB.prepare(
      `CREATE TRIGGER fail_performance_rollup_completion
       BEFORE INSERT ON performance_sample_aggregation_days
       BEGIN SELECT RAISE(FAIL, 'forced rollup completion failure'); END`,
    ).run();

    await runScheduledMaintenance(env.DB, AUGUST_10 + 10 * DAY_MS);

    expect(await aggregateRows()).toEqual(staleAggregates);
    const rawAfterFailure = await env.DB.prepare(
      'SELECT build_id FROM performance_samples ORDER BY build_id',
    ).all<{ build_id: string }>();
    expect(rawAfterFailure.results.map(({ build_id }) => build_id)).toEqual(['build-a', 'build-b']);
    expect(
      (
        await env.DB.prepare(
          'SELECT * FROM performance_sample_aggregation_days WHERE day_start = ?',
        )
          .bind(AUGUST_10)
          .all()
      ).results,
    ).toHaveLength(0);

    await env.DB.prepare('DROP TRIGGER fail_performance_rollup_completion').run();
    await runScheduledMaintenance(env.DB, AUGUST_10 + 10 * DAY_MS);
    expect(
      (await aggregateRows()).map(({ build_id, surface, sample_count }) => ({
        build_id,
        surface,
        sample_count,
      })),
    ).toEqual([
      { build_id: 'build-a', surface: 'editor', sample_count: 1 },
      { build_id: 'build-b', surface: 'share', sample_count: 1 },
    ]);
    expect(
      (await env.DB.prepare('SELECT build_id FROM performance_samples').all()).results,
    ).toHaveLength(0);
  });
});

describe('independent scheduled maintenance', () => {
  it('still removes expired shares when telemetry aggregation fails', async () => {
    await insertSample({ receivedAt: AUGUST_10 });
    await insertSystem('expired', AUGUST_10);
    await insertSystem('live', AUGUST_10 + 20 * DAY_MS);
    await env.DB.prepare(
      `CREATE TRIGGER fail_performance_rollup
       BEFORE INSERT ON performance_daily_aggregates
       BEGIN SELECT RAISE(FAIL, 'forced rollup failure'); END`,
    ).run();

    await runScheduledMaintenance(env.DB, AUGUST_10 + 10 * DAY_MS);

    const systems = await env.DB.prepare('SELECT id FROM systems ORDER BY id').all<{
      id: string;
    }>();
    expect(systems.results.map((row) => row.id)).toEqual(['live']);
    expect((await env.DB.prepare('SELECT * FROM performance_samples').all()).results).toHaveLength(
      1,
    );
    await env.DB.prepare('DROP TRIGGER fail_performance_rollup').run();
  });

  it('still surfaces an expired-share cleanup failure for cron retry', async () => {
    await insertSystem('expired', AUGUST_10);
    await env.DB.prepare(
      `CREATE TRIGGER fail_share_cleanup
       BEFORE DELETE ON systems
       BEGIN SELECT RAISE(FAIL, 'forced share cleanup failure'); END`,
    ).run();

    await expect(runScheduledMaintenance(env.DB, AUGUST_10 + 10 * DAY_MS)).rejects.toThrow(
      /forced share cleanup failure/,
    );

    await env.DB.prepare('DROP TRIGGER fail_share_cleanup').run();
  });
});
