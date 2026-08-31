import { PERF_SCENARIO_LIST } from '../../perf.config';
import type { PerfScenario } from '../../src/perf/types';
import type { PerfCliOptions } from './cli';

function validateMatrixOptions(options: PerfCliOptions): void {
  if (
    (options.record || options.freezeBaseline) &&
    (options.scenarioId || options.firstSession || options.onboarding)
  ) {
    throw new Error('--record and --freeze-baseline require the full scenario matrix.');
  }
}

function validateSmokeOptions(options: PerfCliOptions): void {
  const incompatible = options.record || options.freezeBaseline || options.soak;
  if (options.smoke && incompatible) {
    throw new Error('--smoke cannot be combined with --record, --freeze-baseline, or --soak.');
  }
  if (options.smoke && options.baselinePath) {
    throw new Error('--smoke is functional evidence and cannot be compared with --baseline.');
  }
}

function validateSoakOptions(options: PerfCliOptions): void {
  const incompatible =
    options.record ||
    options.freezeBaseline ||
    Boolean(options.scenarioId) ||
    options.firstSession ||
    options.onboarding;
  if (options.soak && incompatible) {
    throw new Error(
      '--soak cannot be combined with --record, --freeze-baseline, --scenario, --first-session, or --onboarding.',
    );
  }
  if (!options.soak && options.soakDurationMs !== 10 * 60 * 1_000) {
    throw new Error('--soak-duration requires --soak.');
  }
  if (options.soak && options.profile !== 'desktop') {
    throw new Error('--soak uses the desktop RTC protocol; omit --profile mobile.');
  }
}

function validateFreezeOptions(options: PerfCliOptions): void {
  if (options.freezeBaseline && options.baselinePath !== undefined) {
    throw new Error('--freeze-baseline cannot compare with an existing baseline.');
  }
}

export function validateAuditOptions(options: PerfCliOptions): void {
  validateMatrixOptions(options);
  validateSmokeOptions(options);
  validateSoakOptions(options);
  validateFreezeOptions(options);
}

export function selectedAuditScenarios(options: PerfCliOptions): PerfScenario[] {
  return options.scenarioId
    ? PERF_SCENARIO_LIST.filter((scenario) => scenario.id === options.scenarioId)
    : PERF_SCENARIO_LIST;
}
