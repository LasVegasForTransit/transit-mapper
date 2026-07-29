import { mkdir } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright-core';
import {
  createPerfProtocol,
  PERF_MAX_REGRESSION_RATIO,
  PERF_SCENARIO_LIST,
} from '../../perf.config';
import { evaluatePerfBudgets } from '../../src/perf/budget';
import { createPerfReport, createUnavailablePerfReport } from '../../src/perf/report';
import type { PerfCalibration, PerfSample, PerfScenario } from '../../src/perf/types';
import {
  checkedBaselinePath,
  chromeUnavailableReason,
  copyBuildReports,
  readBaseline,
  readBundleEntries,
  reportEvaluation,
  writeCheckedBaseline,
  writeReport,
} from './artifacts';
import { runCalibration } from './browser';
import type { PerfCliOptions } from './cli';
import { verifyCacheEvictedOfflineReload } from './offline';
import { buildPerformanceApp, type RunningPreview, startPreview, stopPreview } from './process';
import { runScenario } from './scenarioRuns';
import { runSoak } from './soak';

function validateOptions(options: PerfCliOptions): void {
  if (options.record && options.scenarioId) {
    throw new Error('--record requires the full scenario matrix; omit --scenario.');
  }
  if (options.smoke && (options.record || options.soak || options.requireBaseline)) {
    throw new Error('--smoke cannot be combined with --record, --soak, or --require-baseline.');
  }
  if (options.smoke && options.baselinePath) {
    throw new Error('--smoke is functional evidence and cannot be compared with --baseline.');
  }
  if (options.soak && (options.record || options.scenarioId)) {
    throw new Error('--soak cannot be combined with --record or --scenario.');
  }
  if (!options.soak && options.soakDurationMs !== 10 * 60 * 1_000) {
    throw new Error('--soak-duration requires --soak.');
  }
  if (options.soak && options.profile !== 'desktop') {
    throw new Error('--soak uses the desktop RTC protocol; omit --profile mobile.');
  }
}

function selectedScenarios(options: PerfCliOptions): PerfScenario[] {
  return options.scenarioId
    ? PERF_SCENARIO_LIST.filter((scenario) => scenario.id === options.scenarioId)
    : PERF_SCENARIO_LIST;
}

export async function runPerformanceAudit(options: PerfCliOptions): Promise<void> {
  validateOptions(options);
  const protocol = createPerfProtocol(options.profile, options.smoke ? 'smoke' : 'audit');
  const scenarios = selectedScenarios(options);
  await mkdir(options.outputDirectory, { recursive: true });
  if (!options.skipBuild) await buildPerformanceApp();
  await copyBuildReports(options.outputDirectory);
  const bundles = await readBundleEntries();
  const baseline = await readBaseline(options.baselinePath ?? checkedBaselinePath(options.profile));

  let preview: RunningPreview | undefined;
  let browser: Browser | undefined;
  let calibration: PerfCalibration | undefined;
  try {
    preview = await startPreview();
    browser = await chromium.launch({
      channel: protocol.browserChannel,
      headless: false,
    });
    if (options.soak) {
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

    calibration = await runCalibration(browser, protocol);
    await verifyCacheEvictedOfflineReload(browser, protocol, preview.url, options.outputDirectory);
    const samples: PerfSample[] = [];
    for (const scenario of scenarios) {
      samples.push(
        ...(await runScenario({
          browser,
          protocol,
          previewUrl: preview.url,
          scenario,
          outputDirectory: options.outputDirectory,
          record: options.record,
        })),
      );
    }
    const report = createPerfReport({
      generatedAt: new Date().toISOString(),
      protocol,
      scenarios,
      samples,
      bundles,
      calibration,
    });
    const evaluation = evaluatePerfBudgets({
      report,
      baseline,
      scenarios,
      maxRegressionRatio: PERF_MAX_REGRESSION_RATIO,
      requireBaseline: options.requireBaseline,
      enforceNumericBudgets: !options.smoke,
    });
    report.evaluation = evaluation;
    const reportPath = await writeReport(options.outputDirectory, report);
    if (options.record) {
      const path = checkedBaselinePath(options.profile);
      await writeCheckedBaseline(path, report);
      console.log(`performance baseline refreshed: ${path}`);
    }
    reportEvaluation(evaluation);
    console.log(`performance report: ${reportPath}`);
    if (evaluation.status !== 'pass') process.exitCode = 1;
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
