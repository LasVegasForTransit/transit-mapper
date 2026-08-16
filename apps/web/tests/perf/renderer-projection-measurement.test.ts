import { describe, expect, it } from 'vitest';
import { createSourceFeatureProjectionCounts } from '../../src/map/sourceFeatureProjection';
import { createRendererProjectionMeasurement } from '../../src/perf/renderer-projection-measurement';
import { createRendererStatsCollector } from '../../src/perf/renderer-stats';

describe('renderer projection measurement', () => {
  it('keeps production camera settlement timing without collecting private diagnostics', () => {
    let nowMs = 10;
    const collector = createRendererStatsCollector();
    const measurement = createRendererProjectionMeasurement({
      counts: createSourceFeatureProjectionCounts(),
      collector,
      enabled: false,
      now: () => nowMs,
    });

    measurement.recordScheduling({
      submittedJobCount: 1,
      committedJobCount: 1,
      canceledJobCount: 0,
      failedJobCount: 0,
      sliceCount: 2,
      unitRunCount: 2,
      commitAttemptCount: 1,
      yieldCount: 1,
      totalSliceDurationMs: 3,
      maxSliceDurationMs: 2,
      maxUnitDurationMs: 1,
      maxCommitDurationMs: 0.5,
    });
    measurement.recordPreparation({
      preparationCount: 1,
      preparationDurationMs: 1,
      maxPreparationDurationMs: 1,
      overBudgetPreparationCount: 0,
    });
    nowMs = 28;

    expect(measurement.markSettled()).toBe(18);
    measurement.recordCommitted();
    expect(collector.snapshot()).toMatchObject({
      projectionCount: 0,
      projectionSliceCount: 0,
      projectionPreparationCount: 0,
    });
  });

  it('separates scheduled CPU and unscheduled planning from frame-queue latency', () => {
    let nowMs = 0;
    const counts = createSourceFeatureProjectionCounts();
    const collector = createRendererStatsCollector();
    const measurement = createRendererProjectionMeasurement({
      counts,
      collector,
      enabled: true,
      now: () => nowMs,
    });

    counts.featureTopologyWayVisitCount = 3;
    counts.rendererCandidateFeatureCount = 3;
    measurement.recordScheduling({
      submittedJobCount: 1,
      committedJobCount: 1,
      canceledJobCount: 0,
      failedJobCount: 0,
      sliceCount: 1,
      unitRunCount: 1,
      commitAttemptCount: 1,
      yieldCount: 0,
      totalSliceDurationMs: 2,
      maxSliceDurationMs: 2,
      maxUnitDurationMs: 1.5,
      maxCommitDurationMs: 0.5,
    });
    measurement.recordPreparation({
      preparationCount: 1,
      preparationDurationMs: 1,
      maxPreparationDurationMs: 1,
      overBudgetPreparationCount: 0,
      includedInScheduling: true,
    });
    measurement.recordPreparation({
      preparationCount: 1,
      preparationDurationMs: 0.5,
      maxPreparationDurationMs: 0.5,
      overBudgetPreparationCount: 0,
    });
    nowMs = 53;

    expect(measurement.markSettled()).toBe(53);
    measurement.recordCommitted();

    expect(collector.snapshot()).toMatchObject({
      projectionCount: 1,
      projectionDurationMs: 2.5,
      projectionSettlementLatencyMs: 53,
      projectionScheduledDurationMs: 2,
      projectionPreparationDurationMs: 1.5,
      candidateFeatureCount: 3,
    });
  });
});
