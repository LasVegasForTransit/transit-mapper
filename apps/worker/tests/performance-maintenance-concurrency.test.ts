import { afterEach, describe, expect, it, vi } from 'vitest';
import { runScheduledMaintenance } from '../src/performance-maintenance';
import { sampleRow, TestPerformanceDatabase } from './support/performance-maintenance-d1.test';

const DAY_MS = 24 * 60 * 60 * 1000;
const AUGUST_10 = Date.UTC(2026, 7, 10);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('performance aggregation concurrency', () => {
  it('lets one overlapping runner commit without allowing the loser to replace it', async () => {
    const database = new TestPerformanceDatabase({
      samples: [sampleRow(1, AUGUST_10 + 1, 100)],
      waitForTwoBatches: true,
    });
    const firstCompletion = AUGUST_10 + DAY_MS + 1;
    const secondCompletion = firstCompletion + 1;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await Promise.all([
      runScheduledMaintenance(database, firstCompletion),
      runScheduledMaintenance(database, secondCompletion),
    ]);

    expect(database.batchAttempts).toBe(2);
    expect(database.completion).toEqual({
      dayStart: AUGUST_10,
      sampleCount: 1,
      completedAt: firstCompletion,
    });
    expect(database.aggregates).toHaveLength(1);
    expect(database.aggregates[0]).toMatchObject({
      dayStart: AUGUST_10,
      buildId: 'build-a',
      sampleCount: 1,
      completedAt: firstCompletion,
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('abandons a stale snapshot and includes the concurrent sample on retry', async () => {
    const database = new TestPerformanceDatabase({
      samples: [sampleRow(1, AUGUST_10 + 1, 100)],
      insertAfterFirstCohortRead: sampleRow(2, AUGUST_10 + 2, 200),
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runScheduledMaintenance(database, AUGUST_10 + DAY_MS + 1);

    expect(database.samples).toHaveLength(2);
    expect(database.completion).toBeNull();
    expect(database.aggregates).toEqual([]);
    expect(database.rawRetentionAttempts).toBe(0);
    expect(error).toHaveBeenCalledWith(
      'Performance sample maintenance failed',
      expect.objectContaining({ message: 'CHECK constraint failed: sample_count' }),
    );

    await runScheduledMaintenance(database, AUGUST_10 + DAY_MS + 2);

    expect(database.completion).toMatchObject({ dayStart: AUGUST_10, sampleCount: 2 });
    expect(database.aggregates).toHaveLength(1);
    expect(database.aggregates[0]?.sampleCount).toBe(2);
    const metrics = JSON.parse(database.aggregates[0]?.metricsJson ?? '{}') as Record<
      string,
      { count: number; min: number; max: number }
    >;
    expect(metrics.lcp_ms).toMatchObject({ count: 2, min: 100, max: 200 });
    expect(database.rawRetentionAttempts).toBe(1);
  });

  it('does not hide an unrelated metric failure after a peer completes the day', async () => {
    const database = new TestPerformanceDatabase({
      samples: [sampleRow(1, AUGUST_10 + 1, 100)],
      failSecondMetricAfterPeerCompletion: true,
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await Promise.all([
      runScheduledMaintenance(database, AUGUST_10 + DAY_MS + 1),
      runScheduledMaintenance(database, AUGUST_10 + DAY_MS + 2),
    ]);

    expect(database.completion).toMatchObject({ dayStart: AUGUST_10, sampleCount: 1 });
    expect(error).toHaveBeenCalledWith(
      'Performance sample maintenance failed',
      expect.objectContaining({ message: 'forced unrelated metric failure' }),
    );
    expect(database.rawRetentionAttempts).toBe(1);
  });
});
