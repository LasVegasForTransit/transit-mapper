import { mkdir } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright-core';
import {
  createPerfProtocol,
  PERF_FIRST_SESSION_BYTE_BUDGETS,
  PERF_MAX_REGRESSION_RATIO,
  PERF_SCENARIO_LIST,
} from '../../perf.config';
import { evaluatePerfBudgets } from '../../src/perf/budget';
import { createPerfReport, createUnavailablePerfReport } from '../../src/perf/report';
import type {
  PerfBundleEntry,
  PerfCalibration,
  PerfFirstSessionSample,
  PerfProtocol,
  PerfReport,
  PerfSample,
  PerfScenario,
} from '../../src/perf/types';
import {
  checkedBaselinePath,
  chromeUnavailableReason,
  copyBuildReports,
  freezeCheckedBaseline,
  readBaseline,
  readBundleEntries,
  reportEvaluation,
  writeReport,
} from './artifacts';
import { runCalibration } from './browser';
import type { PerfCliOptions } from './cli';
import { verifyCacheEvictedOfflineReload } from './offline';
import { runFirstSessionMatrix } from './first-session-matrix';
import { createPlaywrightFirstSessionSurfaceRunner } from './playwright-first-session';
import { allocateChromeDebuggingPort, chromeDebuggingArgument } from './flat-cdp-connection';
import {
  assertPerformanceArtifactOutputs,
  buildPerformanceApp,
  type RunningPreview,
  startPreview,
  stopPreview,
} from './process';
import { runScenario } from './scenarioRuns';
import { runSoak } from './soak';

function validateMatrixOptions(options: PerfCliOptions): void {
  if ((options.record || options.freezeBaseline) && options.scenarioId) {
    throw new Error('--record and --freeze-baseline require the full scenario matrix.');
  }
}

function validateSmokeOptions(options: PerfCliOptions): void {
  const incompatible =
    options.record || options.freezeBaseline || options.soak || options.requireBaseline;
  if (options.smoke && incompatible) {
    throw new Error(
      '--smoke cannot be combined with --record, --freeze-baseline, --soak, or --require-baseline.',
    );
  }
  if (options.smoke && options.baselinePath) {
    throw new Error('--smoke is functional evidence and cannot be compared with --baseline.');
  }
}

function validateSoakOptions(options: PerfCliOptions): void {
  const incompatible = options.record || options.freezeBaseline || options.scenarioId;
  if (options.soak && incompatible) {
    throw new Error('--soak cannot be combined with --record, --freeze-baseline, or --scenario.');
  }
  if (!options.soak && options.soakDurationMs !== 10 * 60 * 1_000) {
    throw new Error('--soak-duration requires --soak.');
  }
  if (options.soak && options.profile !== 'desktop') {
    throw new Error('--soak uses the desktop RTC protocol; omit --profile mobile.');
  }
}

function validateFreezeOptions(options: PerfCliOptions): void {
  const incompatible = options.baselinePath !== undefined || options.requireBaseline;
  if (options.freezeBaseline && incompatible) {
    throw new Error('--freeze-baseline cannot compare with or require an existing baseline.');
  }
}

function validateOptions(options: PerfCliOptions): void {
  validateMatrixOptions(options);
  validateSmokeOptions(options);
  validateSoakOptions(options);
  validateFreezeOptions(options);
}

function selectedScenarios(options: PerfCliOptions): PerfScenario[] {
  return options.scenarioId
    ? PERF_SCENARIO_LIST.filter((scenario) => scenario.id === options.scenarioId)
    : PERF_SCENARIO_LIST;
}

interface InstrumentedJourneyOptions {
  browser: Browser;
  protocol: PerfProtocol;
  preview: RunningPreview;
  scenarios: PerfScenario[];
  cli: PerfCliOptions;
}

interface InstrumentedJourneyResults {
  calibration: PerfCalibration;
  samples: PerfSample[];
}

interface AuditJourneyResults extends InstrumentedJourneyResults {
  firstSessions: PerfFirstSessionSample[];
}

async function runInstrumentedJourneys(
  options: InstrumentedJourneyOptions,
): Promise<InstrumentedJourneyResults> {
  const calibration = await runCalibration(options.browser, options.protocol);
  await verifyCacheEvictedOfflineReload(
    options.browser,
    options.protocol,
    options.preview.url,
    options.cli.outputDirectory,
  );
  const samples: PerfSample[] = [];
  for (const scenario of options.scenarios) {
    samples.push(
      ...(await runScenario({
        browser: options.browser,
        protocol: options.protocol,
        previewUrl: options.preview.url,
        scenario,
        outputDirectory: options.cli.outputDirectory,
        record: options.cli.record,
      })),
    );
  }
  return { calibration, samples };
}

interface PublicFirstSessionOptions {
  browser: Browser;
  protocol: PerfProtocol;
  preview: RunningPreview;
  debuggingPort: number;
}

async function runPublicFirstSessions(
  options: PublicFirstSessionOptions,
): Promise<PerfFirstSessionSample[]> {
  console.log('perf first sessions: public editor, share, and cross-site embed');
  return runFirstSessionMatrix(
    createPlaywrightFirstSessionSurfaceRunner(
      options.browser,
      options.protocol,
      options.preview.url,
      options.debuggingPort,
    ),
  );
}

interface WriteAuditOptions {
  cli: PerfCliOptions;
  protocol: PerfProtocol;
  scenarios: PerfScenario[];
  bundles: PerfBundleEntry[];
  baseline: PerfReport | undefined;
  results: AuditJourneyResults;
}

async function writeMeasuredAudit(options: WriteAuditOptions): Promise<void> {
  const report = createPerfReport({
    generatedAt: new Date().toISOString(),
    protocol: options.protocol,
    scenarios: options.scenarios,
    samples: options.results.samples,
    bundles: options.bundles,
    calibration: options.results.calibration,
    firstSessions: options.results.firstSessions,
  });
  const evaluation = evaluatePerfBudgets({
    report,
    baseline: options.baseline,
    scenarios: options.scenarios,
    maxRegressionRatio: PERF_MAX_REGRESSION_RATIO,
    firstSessionBudgets: PERF_FIRST_SESSION_BYTE_BUDGETS,
    requireBaseline: options.cli.requireBaseline,
    enforceNumericBudgets: !options.cli.smoke,
  });
  report.evaluation = evaluation;
  const reportPath = await writeReport(options.cli.outputDirectory, report);
  if (options.cli.freezeBaseline) {
    const path = checkedBaselinePath(options.cli.profile);
    await freezeCheckedBaseline(path, report);
    console.log(`performance baseline frozen: ${path}`);
  }
  reportEvaluation(evaluation);
  console.log(`performance report: ${reportPath}`);
  if (evaluation.status !== 'pass') process.exitCode = 1;
}

export async function runPerformanceAudit(options: PerfCliOptions): Promise<void> {
  validateOptions(options);
  const protocol = createPerfProtocol(options.profile, options.smoke ? 'smoke' : 'audit');
  const scenarios = selectedScenarios(options);
  await mkdir(options.outputDirectory, { recursive: true });
  if (!options.skipBuild) await buildPerformanceApp();
  else await assertPerformanceArtifactOutputs();
  await copyBuildReports(options.outputDirectory);
  const bundles = await readBundleEntries();
  const baseline = await readBaseline(options.baselinePath ?? checkedBaselinePath(options.profile));

  let preview: RunningPreview | undefined;
  let browser: Browser | undefined;
  let calibration: PerfCalibration | undefined;
  try {
    const debuggingPort = await allocateChromeDebuggingPort();
    browser = await chromium.launch({
      channel: protocol.browserChannel,
      headless: false,
      args: [chromeDebuggingArgument(debuggingPort)],
    });
    if (options.soak) {
      preview = await startPreview('instrumented');
      const soak = await runSoak(
        browser,
        protocol,
        preview.url,
        options.outputDirectory,
        options.soakDurationMs,
      );
      if (soak.status !== 'pass') process.exitCode = 1;
      return;
    }

    preview = await startPreview('instrumented');
    const instrumented = await runInstrumentedJourneys({
      browser,
      protocol,
      preview,
      scenarios,
      cli: options,
    });
    calibration = instrumented.calibration;
    await stopPreview(preview);
    preview = await startPreview('public');
    const firstSessions = await runPublicFirstSessions({
      browser,
      protocol,
      preview,
      debuggingPort,
    });
    await writeMeasuredAudit({
      cli: options,
      protocol,
      scenarios,
      bundles,
      baseline,
      results: {
        calibration: instrumented.calibration,
        firstSessions,
        samples: instrumented.samples,
      },
    });
  } catch (error) {
    const reason = chromeUnavailableReason(error);
    const report = createUnavailablePerfReport({
      generatedAt: new Date().toISOString(),
      protocol,
      scenarios,
      reason,
      bundles,
      calibration,
    });
    const reportPath = await writeReport(options.outputDirectory, report);
    console.error(`performance unavailable: ${reason}`);
    console.error(`performance report: ${reportPath}`);
    process.exitCode = 2;
  } finally {
    await browser?.close();
    await stopPreview(preview);
  }
}
