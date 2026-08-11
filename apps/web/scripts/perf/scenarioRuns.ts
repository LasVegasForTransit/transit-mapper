import { relative, resolve } from 'node:path';
import type { Browser } from 'playwright-core';
import { generatePerfFixture } from '../../src/perf/fixtures';
import type {
  PerfMetricValues,
  PerfProtocol,
  PerfSample,
  PerfScenario,
} from '../../src/perf/types';
import {
  closeContext,
  collectMemory,
  collectStartupMetrics,
  configureProtocol,
  configureSurfaceRoutes,
  installPerformanceInstrumentation,
  measureCompatibilityPersistenceDiagnostic,
  seedIndexedDbFixture,
  startTrace,
  stopTrace,
} from './browser';
import { runMeasuredJourney, waitForScenarioReady } from './journeys';
import { combineProductionPersistence } from './production-persistence';

interface RunSampleOptions {
  browser: Browser;
  protocol: PerfProtocol;
  previewUrl: string;
  scenario: PerfScenario;
  outputDirectory: string;
  measuredRun?: number;
  tracePath?: string;
}

export interface RunScenarioOptions {
  browser: Browser;
  protocol: PerfProtocol;
  previewUrl: string;
  scenario: PerfScenario;
  outputDirectory: string;
  record: boolean;
}

async function runSample(options: RunSampleOptions): Promise<PerfSample | undefined> {
  const context = await options.browser.newContext({
    viewport: {
      width: options.protocol.viewport.width,
      height: options.protocol.viewport.height,
    },
    deviceScaleFactor: options.protocol.viewport.deviceScaleFactor,
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  let traceStarted = false;

  try {
    await configureProtocol(session, options.protocol);
    const fixture = generatePerfFixture(options.scenario.fixtureId);
    const serializedFixture = JSON.stringify(fixture);
    const compatibilityPersistence = await measureCompatibilityPersistenceDiagnostic(
      page,
      session,
      options.previewUrl,
      serializedFixture,
    );
    await seedIndexedDbFixture(page, serializedFixture, fixture);
    await installPerformanceInstrumentation(page);
    await session.send('Network.clearBrowserCache');
    await configureSurfaceRoutes(page, options.scenario, serializedFixture);
    if (options.tracePath) {
      await startTrace(session);
      traceStarted = true;
    }

    await page.goto(`${options.previewUrl}${options.scenario.path}`, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    await waitForScenarioReady(page, options.scenario, fixture.name, 'cold');
    if (options.scenario.surface === 'editor') {
      await page.getByLabel('Pause the simulation (K)').waitFor({
        state: 'visible',
        timeout: 30_000,
      });
    }
    const startup = await collectStartupMetrics(page);
    // Source order makes the edge Stop deterministic when low-zoom hit circles overlap.
    const target = fixture.stops.at(-1);
    const entity = target?.name ? { id: target.id, name: target.name } : undefined;
    const gesture = await runMeasuredJourney(
      page,
      options.scenario,
      entity,
      options.scenario.surface === 'editor' ? 'running' : 'not-applicable',
    );
    const coldMemory = await collectMemory(session);

    await page.reload({ waitUntil: 'load', timeout: 60_000 });
    await waitForScenarioReady(page, options.scenario, fixture.name, 'warm');
    if (options.scenario.surface === 'editor') {
      const pause = page.getByLabel('Pause the simulation (K)');
      await pause.waitFor({ state: 'visible', timeout: 30_000 });
      await page.keyboard.press('k');
      await page.getByLabel('Run the simulation (K)').waitFor({
        state: 'visible',
        timeout: 30_000,
      });
    }
    const warmStartup = await collectStartupMetrics(page);
    const warmGesture = await runMeasuredJourney(
      page,
      options.scenario,
      entity,
      options.scenario.surface === 'editor' ? 'paused' : 'not-applicable',
    );
    const warmMemory = await collectMemory(session);
    const metrics: PerfMetricValues = {
      ...startup.metrics,
      ...gesture.metrics,
      warmLoadMs: warmStartup.metrics.loadMs,
      warmLargestContentfulPaintMs: warmStartup.metrics.largestContentfulPaintMs,
      warmCumulativeLayoutShift: warmStartup.metrics.cumulativeLayoutShift,
      warmInputToNextPaintP95Ms: warmGesture.metrics.inputToNextPaintP95Ms,
    };

    if (options.tracePath) {
      await stopTrace(session, options.tracePath);
      traceStarted = false;
    }
    if (options.measuredRun === undefined) return undefined;
    return {
      scenarioId: options.scenario.id,
      run: options.measuredRun,
      metrics,
      gesture: gesture.diagnostics,
      warmGesture: warmGesture.diagnostics,
      counters: {
        ...gesture.counters,
        domNodeCount: coldMemory.domNodeCount,
      },
      warmCounters: {
        ...warmGesture.counters,
        domNodeCount: warmMemory.domNodeCount,
      },
      network: startup.network,
      warmNetwork: warmStartup.network,
      memory: coldMemory.memory,
      warmMemory: warmMemory.memory,
      rendererStats: gesture.rendererStats,
      warmRendererStats: warmGesture.rendererStats,
      persistence: {
        ...compatibilityPersistence,
        production: combineProductionPersistence({
          cold: gesture.persistence,
          warm: warmGesture.persistence,
        }),
      },
      traceArtifact: options.tracePath
        ? relative(options.outputDirectory, options.tracePath)
        : undefined,
    };
  } finally {
    if (traceStarted) {
      try {
        await session.send('Tracing.end');
      } catch {
        // The run's original error is more useful than trace cleanup failure.
      }
    }
    await closeContext(context);
  }
}

export async function runScenario(options: RunScenarioOptions): Promise<PerfSample[]> {
  for (let run = 1; run <= options.protocol.warmupRuns; run += 1) {
    console.log(`perf ${options.scenario.id}: warm-up ${run}/${options.protocol.warmupRuns}`);
    await runSample(options);
  }

  const samples: PerfSample[] = [];
  for (let run = 1; run <= options.protocol.measuredRuns; run += 1) {
    const tracePath = options.record
      ? resolve(options.outputDirectory, 'traces', `${options.scenario.id}-run-${run}.trace.json`)
      : undefined;
    console.log(
      `perf ${options.scenario.id}: measured run ${run}/${options.protocol.measuredRuns}`,
    );
    const sample = await runSample({
      ...options,
      measuredRun: run,
      tracePath,
    });
    if (!sample) throw new Error(`${options.scenario.id} run ${run} produced no sample.`);
    samples.push(sample);
  }
  return samples;
}
