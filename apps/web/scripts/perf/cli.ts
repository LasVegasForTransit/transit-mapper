import { resolve } from 'node:path';
import { PERF_DEFAULT_ARTIFACT_DIRECTORY, PERF_SCENARIO_LIST } from '../../perf.config';
import type { PerfProfileId, PerfScenario } from '../../src/perf/types';
import { APP_ROOT } from './process';

export interface PerfCliOptions {
  record: boolean;
  outputDirectory: string;
  baselinePath?: string;
  requireBaseline: boolean;
  skipBuild: boolean;
  profile: PerfProfileId;
  scenarioId?: PerfScenario['id'];
  soak: boolean;
  soakDurationMs: number;
  help: boolean;
}

export function perfUsage(): string {
  return [
    'Usage: pnpm perf [options]',
    '',
    'Options:',
    '  --output <directory>   JSON/trace artifact directory',
    '  --baseline <report>    Compare medians with another report',
    '  --require-baseline     Fail when --baseline is absent or unavailable',
    '  --profile <name>        desktop (default) or mobile',
    '  --scenario <id>         Run one scenario for local diagnosis',
    '  --soak                  Run the ten-minute RTC leak gate',
    '  --soak-duration <ms>    Shorter local soak smoke (default 600000)',
    '  --skip-build           Reuse the current dist/ output',
    '  --record               Retain one Chrome trace per measured run',
    '  --help                 Show this help',
  ].join('\n');
}

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

export function parsePerfCliOptions(args: string[]): PerfCliOptions {
  let record = false;
  let output: string | undefined;
  let baseline: string | undefined;
  let requireBaseline = false;
  let skipBuild = false;
  let profile: PerfProfileId = 'desktop';
  let scenarioId: PerfScenario['id'] | undefined;
  let soak = false;
  let soakDurationMs = 10 * 60 * 1_000;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--record') record = true;
    else if (argument === '--soak') soak = true;
    else if (argument === '--soak-duration') {
      const value = Number(optionValue(args, index, argument));
      if (!Number.isInteger(value) || value < 1_000) {
        throw new Error('--soak-duration must be an integer of at least 1000 ms.');
      }
      soakDurationMs = value;
      index += 1;
    } else if (argument === '--require-baseline') requireBaseline = true;
    else if (argument === '--skip-build') skipBuild = true;
    else if (argument === '--profile') {
      const value = optionValue(args, index, argument);
      if (value !== 'desktop' && value !== 'mobile') {
        throw new Error(`--profile must be desktop or mobile, not "${value}".`);
      }
      profile = value;
      index += 1;
    } else if (argument === '--scenario') {
      const value = optionValue(args, index, argument);
      const scenario = PERF_SCENARIO_LIST.find((candidate) => candidate.id === value);
      if (!scenario) throw new Error(`Unknown performance scenario: "${value}".`);
      scenarioId = scenario.id;
      index += 1;
    } else if (argument === '--help') help = true;
    else if (argument === '--output') {
      output = optionValue(args, index, argument);
      index += 1;
    } else if (argument === '--baseline') {
      baseline = optionValue(args, index, argument);
      index += 1;
    } else {
      throw new Error(`Unknown performance option: ${argument}`);
    }
  }

  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const defaultOutput = record
    ? resolve(APP_ROOT, PERF_DEFAULT_ARTIFACT_DIRECTORY, 'recorded', profile, timestamp)
    : resolve(APP_ROOT, PERF_DEFAULT_ARTIFACT_DIRECTORY, 'current', profile);

  return {
    record,
    outputDirectory: resolve(APP_ROOT, output ?? defaultOutput),
    baselinePath: baseline ? resolve(APP_ROOT, baseline) : undefined,
    requireBaseline,
    skipBuild,
    profile,
    scenarioId,
    soak,
    soakDurationMs,
    help,
  };
}
