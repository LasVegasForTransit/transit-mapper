import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  completeMeasuredAudit,
  prepareAuditOrReportUnavailable,
  writePartialAudit,
  type AuditJourneyResults,
} from '../../scripts/perf/audit-reporting';
import { parsePerfCliOptions } from '../../scripts/perf/cli';
import { executePerformancePhases } from '../../scripts/perf/phase-execution';
import { createPerfProtocol, PERF_SCENARIOS } from '../../src/perf/scenarios';
import type { PerfMetricValues, PerfReport, PerfSample } from '../../src/perf/types';

function rtcSample(): PerfSample {
  const metrics = Object.fromEntries(
    [
      'loadMs',
      'firstContentfulPaintMs',
      'largestContentfulPaintMs',
      'firstMapCanvasMs',
      'cumulativeLayoutShift',
      'longTaskTotalMs',
      'transferBytes',
      'inputToNextPaintP95Ms',
      'paintedFrameP95Ms',
      'paintedFramesOver33Ratio',
      'maxUnexpectedLongTaskMs',
      'warmLoadMs',
      'warmLargestContentfulPaintMs',
      'warmCumulativeLayoutShift',
      'warmInputToNextPaintP95Ms',
    ].map((name) => [name, 0]),
  ) as unknown as PerfMetricValues;
  const gesture = {
    name: 'entity-drag-draw' as const,
    frameSource: 'map-render' as const,
    inputToNextPaintMs: [],
    paintedFrameMs: [],
    unexpectedLongTaskMs: [],
    actions: ['camera-drag'] as const,
    simulationState: 'running' as const,
  };
  const counters = {
    sourceUploadCount: 0,
    paintedFrameCount: 0,
    unexpectedLongTaskCount: 0,
    domNodeCount: 0,
    phaseCounters: null,
  };
  const network = { requestCount: 0, cacheHitCount: 0, cacheMissCount: 0, transferBytes: 0 };
  const memory = { jsHeapUsedBytes: 0, jsHeapTotalBytes: 0 };
  return {
    scenarioId: 'rtc',
    run: 1,
    metrics,
    gesture: { ...gesture, actions: [...gesture.actions] },
    warmGesture: { ...gesture, actions: [...gesture.actions] },
    counters,
    warmCounters: counters,
    network,
    warmNetwork: network,
    memory,
    warmMemory: memory,
    rendererStats: null,
    warmRendererStats: null,
    persistence: {
      serializedBytes: 0,
      parseMs: 0,
      serializationMs: 0,
      localStorageWriteMs: 0,
      localStorageWriteOutcome: 'stored',
      offThreadSerializationThresholdMs: 50,
      indexedDbThresholdBytes: 4_000_000,
      recommendOffThreadSerialization: false,
      recommendIndexedDb: false,
    },
  };
}

async function readOutput(directory: string): Promise<PerfReport> {
  return JSON.parse(await readFile(resolve(directory, 'report.json'), 'utf8')) as PerfReport;
}

function cli(outputDirectory: string) {
  return parsePerfCliOptions(['--smoke', '--scenario', 'rtc', '--output', outputDirectory]);
}

function results(sample: PerfSample): AuditJourneyResults {
  return { samples: [sample], firstSessions: [] };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('performance audit reporting', () => {
  it('writes the completed RTC sample when the first-session phase fails', async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), 'tm-perf-phase-failure-'));
    const sample = rtcSample();
    const captured: AuditJourneyResults = { samples: [], firstSessions: [] };
    const execution = await executePerformancePhases(['instrumented', 'first-session'], (phase) => {
      if (phase === 'instrumented') {
        captured.samples.push(sample);
        return Promise.resolve();
      }
      return Promise.reject(new Error('public share failed'));
    });

    await writePartialAudit({
      cli: cli(outputDirectory),
      protocol: createPerfProtocol('desktop', 'smoke'),
      scenarios: [PERF_SCENARIOS.rtc],
      bundles: [],
      results: captured,
      phases: execution.phases,
      error: execution.error,
    });

    const report = await readOutput(outputDirectory);
    expect(report.samples).toHaveLength(1);
    expect(report.samples[0].scenarioId).toBe('rtc');
    expect(report.phases).toEqual([
      { phase: 'instrumented', status: 'passed' },
      { phase: 'first-session', status: 'failed', reason: 'public share failed' },
    ]);
    expect(process.exitCode).toBe(1);
  });

  it('keeps passed phase evidence when final report output fails', async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), 'tm-perf-output-failure-'));
    const sample = rtcSample();

    await completeMeasuredAudit({
      writeMeasured: () => Promise.reject(new Error('report output failed')),
      partial: {
        cli: cli(outputDirectory),
        protocol: createPerfProtocol('desktop', 'smoke'),
        scenarios: [PERF_SCENARIOS.rtc],
        bundles: [],
        results: results(sample),
        phases: [
          { phase: 'instrumented', status: 'passed' },
          { phase: 'first-session', status: 'passed' },
        ],
      },
    });

    const report = await readOutput(outputDirectory);
    expect(report.status).toBe('partial');
    expect(report.samples).toHaveLength(1);
    expect(report.phases?.every((phase) => phase.status === 'passed')).toBe(true);
    expect(report.failureReason).toBe('report output failed');
    expect(process.exitCode).toBe(1);
  });

  it('writes every requested phase as unavailable when preparation fails', async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), 'tm-perf-setup-failure-'));
    const prepared = await prepareAuditOrReportUnavailable<{ ready: true }>({
      cli: cli(outputDirectory),
      protocol: createPerfProtocol('desktop', 'smoke'),
      scenarios: [PERF_SCENARIOS.rtc],
      requestedPhases: ['instrumented', 'first-session'],
      prepare: () => Promise.reject(new Error('bundle report missing')),
    });

    expect(prepared).toBeUndefined();
    const report = await readOutput(outputDirectory);
    expect(report.status).toBe('unavailable');
    expect(report.phases).toEqual([
      { phase: 'instrumented', status: 'unavailable', reason: 'bundle report missing' },
      { phase: 'first-session', status: 'unavailable', reason: 'bundle report missing' },
    ]);
    expect(process.exitCode).toBe(2);
  });
});
