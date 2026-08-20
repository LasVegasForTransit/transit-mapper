import { mkdir } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright-core';
import {
  createPerfProtocol,
  PERF_FIRST_SESSION_BYTE_BUDGETS,
  PERF_MAX_REGRESSION_RATIO,
} from '../../perf.config';
import { evaluatePerfBudgets } from '../../src/perf/budget';
import {
  createPartialPerfReport,
  createPerfReport,
  createUnavailablePerfReport,
} from '../../src/perf/report';
import type {
  PerfAuditPhase,
  PerfAuditPhaseResult,
  PerfBundleEntry,
  PerfCalibration,
  PerfFirstSessionSample,
  PerfProtocol,
  PerfReport,
  PerfSample,
  PerfScenario,
  PerfOnboardingSample,
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
import { selectedAuditScenarios, validateAuditOptions } from './audit-options';
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
import { executePerformancePhases, requestedPerformancePhases } from './phase-execution';
import { onboardingJourneyViolations } from './onboarding-journey';
import { capturePlaywrightOnboardingJourney } from './playwright-onboarding';

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

interface AuditJourneyResults {
  calibration?: PerfCalibration;
  samples: PerfSample[];
  firstSessions: PerfFirstSessionSample[];
  onboarding?: PerfOnboardingSample;
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
    createPlaywrightFirstSessionSurfaceRunner({
      browser: options.browser,
      protocol: options.protocol,
      previewUrl: options.preview.url,
      debuggingPort: options.debuggingPort,
    }),
  );
}

interface WriteAuditOptions {
  cli: PerfCliOptions;
  protocol: PerfProtocol;
  scenarios: PerfScenario[];
  bundles: PerfBundleEntry[];
  baseline: PerfReport | undefined;
  results: AuditJourneyResults;
  phases: PerfAuditPhaseResult[];
  requestedPhases: readonly PerfAuditPhase[];
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
    phases: options.phases,
    onboarding: options.results.onboarding,
  });
  const evaluation = evaluatePerfBudgets({
    report,
    baseline: options.baseline,
    scenarios: options.scenarios,
    maxRegressionRatio: PERF_MAX_REGRESSION_RATIO,
    firstSessionBudgets: options.requestedPhases.includes('first-session')
      ? PERF_FIRST_SESSION_BYTE_BUDGETS
      : [],
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

class PerformancePreviewSession {
  current: RunningPreview | undefined;

  async use(kind: 'instrumented' | 'public'): Promise<RunningPreview> {
    await stopPreview(this.current);
    this.current = await startPreview(kind);
    return this.current;
  }

  async stop(): Promise<void> {
    await stopPreview(this.current);
    this.current = undefined;
  }
}

interface RunAuditPhasesOptions {
  browser: Browser;
  protocol: PerfProtocol;
  scenarios: PerfScenario[];
  cli: PerfCliOptions;
  debuggingPort: number;
  previews: PerformancePreviewSession;
  results: AuditJourneyResults;
}

async function runAuditPhase(options: RunAuditPhasesOptions, phase: PerfAuditPhase): Promise<void> {
  if (phase === 'instrumented') {
    const instrumented = await runInstrumentedJourneys({
      browser: options.browser,
      protocol: options.protocol,
      preview: await options.previews.use('instrumented'),
      scenarios: options.scenarios,
      cli: options.cli,
    });
    options.results.calibration = instrumented.calibration;
    options.results.samples.push(...instrumented.samples);
    return;
  }
  const publicPreview = await options.previews.use('public');
  if (phase === 'first-session') {
    options.results.firstSessions.push(
      ...(await runPublicFirstSessions({
        browser: options.browser,
        protocol: options.protocol,
        preview: publicPreview,
        debuggingPort: options.debuggingPort,
      })),
    );
    return;
  }
  options.results.onboarding = await capturePlaywrightOnboardingJourney({
    browser: options.browser,
    protocol: options.protocol,
    previewUrl: publicPreview.url,
  });
  const violations = onboardingJourneyViolations(options.results.onboarding);
  if (violations.length > 0) throw new Error(violations.join(' '));
}

interface WritePartialAuditOptions {
  cli: PerfCliOptions;
  protocol: PerfProtocol;
  scenarios: PerfScenario[];
  bundles: PerfBundleEntry[];
  results: AuditJourneyResults;
  phases: PerfAuditPhaseResult[];
  error: unknown;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'The performance phase failed with a non-Error value.';
}

async function writePartialAudit(options: WritePartialAuditOptions): Promise<void> {
  const reason = errorMessage(options.error);
  const report = createPartialPerfReport({
    generatedAt: new Date().toISOString(),
    protocol: options.protocol,
    scenarios: options.scenarios,
    reason,
    bundles: options.bundles,
    calibration: options.results.calibration,
    firstSessions: options.results.firstSessions,
    samples: options.results.samples,
    phases: options.phases,
    onboarding: options.results.onboarding,
  });
  const reportPath = await writeReport(options.cli.outputDirectory, report);
  console.error(`performance phase failed: ${reason}`);
  console.error(`performance report: ${reportPath}`);
  process.exitCode = 1;
}

interface PreparedAudit {
  protocol: PerfProtocol;
  requestedPhases: PerfAuditPhase[];
  scenarios: PerfScenario[];
  bundles: PerfBundleEntry[];
  baseline: PerfReport | undefined;
}

async function prepareAudit(options: PerfCliOptions): Promise<PreparedAudit> {
  validateAuditOptions(options);
  const protocol = createPerfProtocol(options.profile, options.smoke ? 'smoke' : 'audit');
  const requestedPhases = requestedPerformancePhases(options);
  const scenarios = requestedPhases.includes('instrumented') ? selectedAuditScenarios(options) : [];
  await mkdir(options.outputDirectory, { recursive: true });
  if (!options.skipBuild) await buildPerformanceApp();
  else await assertPerformanceArtifactOutputs();
  await copyBuildReports(options.outputDirectory);
  return {
    protocol,
    requestedPhases,
    scenarios,
    bundles: await readBundleEntries(),
    baseline: await readBaseline(options.baselinePath ?? checkedBaselinePath(options.profile)),
  };
}

async function launchAuditBrowser(protocol: PerfProtocol): Promise<{
  browser: Browser;
  debuggingPort: number;
}> {
  const debuggingPort = await allocateChromeDebuggingPort();
  const browser = await chromium.launch({
    channel: protocol.browserChannel,
    headless: false,
    args: [chromeDebuggingArgument(debuggingPort)],
  });
  return { browser, debuggingPort };
}

export async function runPerformanceAudit(options: PerfCliOptions): Promise<void> {
  const { protocol, requestedPhases, scenarios, bundles, baseline } = await prepareAudit(options);

  let preview: RunningPreview | undefined;
  let browser: Browser | undefined;
  const previews = new PerformancePreviewSession();
  const results: AuditJourneyResults = { samples: [], firstSessions: [] };
  try {
    const launched = await launchAuditBrowser(protocol);
    browser = launched.browser;
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
    const phaseOptions = {
      browser,
      protocol,
      scenarios,
      cli: options,
      debuggingPort: launched.debuggingPort,
      previews,
      results,
    };
    const execution = await executePerformancePhases(requestedPhases, (phase) =>
      runAuditPhase(phaseOptions, phase),
    );
    if (execution.error !== undefined) {
      await writePartialAudit({
        cli: options,
        protocol,
        scenarios,
        bundles,
        results,
        phases: execution.phases,
        error: execution.error,
      });
      return;
    }
    await writeMeasuredAudit({
      cli: options,
      protocol,
      scenarios,
      bundles,
      baseline,
      results: {
        ...results,
      },
      phases: execution.phases,
      requestedPhases,
    });
  } catch (error) {
    const reason = chromeUnavailableReason(error);
    const report = createUnavailablePerfReport({
      generatedAt: new Date().toISOString(),
      protocol,
      scenarios,
      reason,
      bundles,
      calibration: results.calibration,
      phases: requestedPhases.map((phase) => ({ phase, status: 'unavailable', reason })),
    });
    const reportPath = await writeReport(options.outputDirectory, report);
    console.error(`performance unavailable: ${reason}`);
    console.error(`performance report: ${reportPath}`);
    process.exitCode = 2;
  } finally {
    await browser?.close();
    await stopPreview(preview);
    await previews.stop();
  }
}
