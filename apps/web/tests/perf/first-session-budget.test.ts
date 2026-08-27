import { describe, expect, it } from 'vitest';
import { evaluatePerfBudgets } from '../../src/perf/budget';
import { createPerfReport } from '../../src/perf/report';
import { createPerfProtocol, PERF_PROTOCOL } from '../../src/perf/scenarios';
import type {
  PerfFirstSessionByteBudget,
  PerfFirstSessionJourney,
  PerfFirstSessionSample,
  PerfReport,
  PerfSurface,
} from '../../src/perf/types';

type PolicyJourney = Exclude<PerfFirstSessionJourney, 'n-minus-one-update'>;

function surfaceForJourney(journey: PolicyJourney): PerfSurface {
  if (journey === 'new-user-editor') return 'editor';
  if (journey === 'public-share') return 'share';
  return 'embed';
}

function firstSession(
  journey: PolicyJourney,
  encodedBytes: number,
  settled = true,
): PerfFirstSessionSample {
  const empty = { encodedBytes: 0, decodedBytes: 0, requestCount: 0 };
  return {
    journey,
    surface: surfaceForJourney(journey),
    cacheState: 'cold',
    milestones: {
      documentResponseEndMs: 20,
      bootstrapStartMs: 5,
      shellMountedMs: 30,
      storageReadStartMs: null,
      storageReadEndMs: null,
      deserializeStartMs: null,
      deserializeEndMs: null,
      systemCommittedMs: 50,
      mapStyleReadyMs: 70,
      firstSystemPaintMs: null,
      interactiveMs: 90,
      networkIdleMs: 100,
      serviceWorkerReadyMs: null,
    },
    network: {
      authority: 'cdp-network-encoded-data-length',
      automaticBoundaryMs: 60_000,
      settled,
      unsettledNonMapRequestCount: settled ? 0 : 1,
      requests: [],
      phases: {},
      total: {
        firstPartyApplication: { ...empty },
        externalMap: { ...empty },
        documentData: { ...empty },
        serviceWorker: { ...empty },
        telemetry: { ...empty },
        other: { ...empty },
        total: { encodedBytes, decodedBytes: encodedBytes, requestCount: 1 },
      },
    },
  };
}

function report(journey?: PolicyJourney, encodedBytes = 0): PerfReport {
  return createPerfReport({
    generatedAt: '2026-07-28T12:00:00.000Z',
    protocol: PERF_PROTOCOL,
    scenarios: [],
    samples: [],
    firstSessions: journey ? [firstSession(journey, encodedBytes)] : [],
  });
}

function evaluate(actual: PerfReport, baseline: PerfReport, budget: PerfFirstSessionByteBudget) {
  return evaluatePerfBudgets({
    report: actual,
    baseline,
    scenarios: [],
    maxRegressionRatio: 0.1,
    firstSessionBudgets: [budget],
  });
}

describe('first-session byte budgets', () => {
  it('rejects a baseline captured with a different fixed protocol', () => {
    const actual = report('new-user-editor', 700_000);
    const baseline = report('new-user-editor', 1_000_000);
    baseline.protocol = createPerfProtocol('mobile');

    const result = evaluate(actual, baseline, {
      journey: 'new-user-editor',
      cacheState: 'cold',
      minimumReductionRatio: 0.3,
    });

    expect(result.violations).toContainEqual(
      expect.objectContaining({ kind: 'baseline-incompatible' }),
    );
  });

  it('keeps the automatic network boundary out of a functional smoke', () => {
    const actual = report('new-user-editor');
    actual.firstSessions = [firstSession('new-user-editor', 0, false)];

    const smoke = evaluatePerfBudgets({
      report: actual,
      scenarios: [],
      maxRegressionRatio: 0.1,
      enforceNumericBudgets: false,
    });
    const audit = evaluatePerfBudgets({
      report: actual,
      scenarios: [],
      maxRegressionRatio: 0.1,
      enforceNumericBudgets: true,
    });

    expect(smoke.status).toBe('pass');
    expect(smoke.violations).toEqual([]);
    expect(audit.status).toBe('fail');
    expect(audit.violations).toContainEqual(
      expect.objectContaining({ kind: 'first-session-unsettled' }),
    );
  });

  it('accepts the brand-new editor at exactly the required byte reduction', () => {
    const result = evaluate(
      report('new-user-editor', 700_000),
      report('new-user-editor', 1_000_000),
      {
        journey: 'new-user-editor',
        cacheState: 'cold',
        minimumReductionRatio: 0.3,
      },
    );

    expect(result.violations).not.toContainEqual(
      expect.objectContaining({ kind: 'first-session-byte-target' }),
    );
  });

  it('fails the brand-new editor one byte above the required reduction', () => {
    const result = evaluate(
      report('new-user-editor', 700_001),
      report('new-user-editor', 1_000_000),
      {
        journey: 'new-user-editor',
        cacheState: 'cold',
        minimumReductionRatio: 0.3,
      },
    );

    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'first-session-byte-target',
        firstSessionJourney: 'new-user-editor',
        actual: 700_001,
        baseline: 1_000_000,
        limit: 700_000,
      }),
    );
  });

  it('rejects any automatic-byte regression on public surfaces', () => {
    const result = evaluate(report('public-share', 200_001), report('public-share', 200_000), {
      journey: 'public-share',
      cacheState: 'cold',
      maximumRegressionRatio: 0,
    });

    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'first-session-byte-regression',
        firstSessionJourney: 'public-share',
        actual: 200_001,
        baseline: 200_000,
        limit: 200_000,
      }),
    );
  });

  it('fails when a required first-session journey is absent', () => {
    const result = evaluate(report(), report('cross-site-embed', 100_000), {
      journey: 'cross-site-embed',
      cacheState: 'cold',
      maximumRegressionRatio: 0,
    });

    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'first-session-sample-missing',
        firstSessionJourney: 'cross-site-embed',
      }),
    );
  });
});
