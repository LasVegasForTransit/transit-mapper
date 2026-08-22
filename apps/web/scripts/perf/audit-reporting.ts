import { createPartialPerfReport, createUnavailablePerfReport } from '../../src/perf/report';
import type {
  PerfAuditPhase,
  PerfAuditPhaseResult,
  PerfBundleEntry,
  PerfCalibration,
  PerfFirstSessionSample,
  PerfOnboardingSample,
  PerfProtocol,
  PerfSample,
  PerfScenario,
} from '../../src/perf/types';
import { chromeUnavailableReason, writeReport } from './artifacts';
import type { PerfCliOptions } from './cli';

export interface AuditJourneyResults {
  calibration?: PerfCalibration;
  samples: PerfSample[];
  firstSessions: PerfFirstSessionSample[];
  onboarding?: PerfOnboardingSample;
}

export interface WritePartialAuditOptions {
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

export async function writePartialAudit(options: WritePartialAuditOptions): Promise<void> {
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

interface WriteUnavailableAuditOptions {
  cli: PerfCliOptions;
  protocol: PerfProtocol;
  scenarios: PerfScenario[];
  requestedPhases: readonly PerfAuditPhase[];
  error: unknown;
  bundles?: PerfBundleEntry[];
}

export async function writeUnavailableAudit(options: WriteUnavailableAuditOptions): Promise<void> {
  const reason = chromeUnavailableReason(options.error);
  const report = createUnavailablePerfReport({
    generatedAt: new Date().toISOString(),
    protocol: options.protocol,
    scenarios: options.scenarios,
    reason,
    bundles: options.bundles ?? [],
    phases: options.requestedPhases.map((phase) => ({
      phase,
      status: 'unavailable',
      reason,
    })),
  });
  const reportPath = await writeReport(options.cli.outputDirectory, report);
  console.error(`performance unavailable: ${reason}`);
  console.error(`performance report: ${reportPath}`);
  process.exitCode = 2;
}

export async function completeMeasuredAudit(options: {
  writeMeasured: () => Promise<void>;
  partial: Omit<WritePartialAuditOptions, 'error'>;
}): Promise<void> {
  try {
    await options.writeMeasured();
  } catch (error) {
    await writePartialAudit({ ...options.partial, error });
  }
}

export async function prepareAuditOrReportUnavailable<T>(options: {
  cli: PerfCliOptions;
  protocol: PerfProtocol;
  scenarios: PerfScenario[];
  requestedPhases: readonly PerfAuditPhase[];
  prepare: () => Promise<T>;
}): Promise<T | undefined> {
  try {
    return await options.prepare();
  } catch (error) {
    await writeUnavailableAudit({ ...options, error });
    return undefined;
  }
}
