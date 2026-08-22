import { resolve } from 'node:path';
import { PERF_DEFAULT_ARTIFACT_DIRECTORY, PERF_SCENARIO_LIST } from '../../perf.config';
import type { PerfProfileId, PerfScenario } from '../../src/perf/types';
import { APP_ROOT } from './process';

export interface PerfCliOptions {
  record: boolean;
  freezeBaseline: boolean;
  outputDirectory: string;
  baselinePath?: string;
  requireBaseline: boolean;
  skipBuild: boolean;
  smoke: boolean;
  profile: PerfProfileId;
  scenarioId?: PerfScenario['id'];
  soak: boolean;
  soakDurationMs: number;
  headless: boolean;
  help: boolean;
  firstSession: boolean;
  onboarding: boolean;
}

export function perfUsage(): string {
  return [
    'Usage: pnpm perf [options]',
    '',
    'Options:',
    '  --output <directory>   JSON/trace artifact directory',
    '  --baseline <report>    Compare medians with another report',
    '  --require-baseline     Require a baseline even in an otherwise exempt mode',
    '  --profile <name>        desktop (default) or mobile',
    '  --scenario <id>         Run one scenario for local diagnosis',
    '  --first-session         Run public editor, share, and embed checks',
    '  --onboarding            Run the onboarding slide-change smoke',
    '  --smoke                 Run one functional sample without numeric timing gates',
    '  --soak                  Run the ten-minute RTC leak gate',
    '  --soak-duration <ms>    Shorter local soak smoke (default 600000)',
    '  --headless              Run Chrome without opening a desktop window',
    '  --skip-build           Reuse the current dist/ output',
    '  --record               Retain one Chrome trace per measured run',
    '  --freeze-baseline      Create the immutable checked baseline explicitly',
    '  --help                 Show this help',
  ].join('\n');
}

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

interface MutablePerfCliOptions {
  record: boolean;
  freezeBaseline: boolean;
  output?: string;
  baseline?: string;
  requireBaseline: boolean;
  skipBuild: boolean;
  smoke: boolean;
  profile: PerfProfileId;
  scenarioId?: PerfScenario['id'];
  soak: boolean;
  soakDurationMs: number;
  headless: boolean;
  help: boolean;
  firstSession: boolean;
  onboarding: boolean;
}

type FlagHandler = (options: MutablePerfCliOptions) => void;

const FLAG_HANDLERS: Readonly<Partial<Record<string, FlagHandler>>> = {
  '--record': (options) => (options.record = true),
  '--freeze-baseline': (options) => (options.freezeBaseline = true),
  '--require-baseline': (options) => (options.requireBaseline = true),
  '--skip-build': (options) => (options.skipBuild = true),
  '--smoke': (options) => (options.smoke = true),
  '--soak': (options) => (options.soak = true),
  '--headless': (options) => (options.headless = true),
  '--help': (options) => (options.help = true),
  '--first-session': (options) => (options.firstSession = true),
  '--onboarding': (options) => (options.onboarding = true),
};

function applyFlag(options: MutablePerfCliOptions, argument: string): boolean {
  if (argument === '--') return true;
  const handler = FLAG_HANDLERS[argument];
  if (!handler) return false;
  handler(options);
  return true;
}

function applyValueOption(options: MutablePerfCliOptions, args: string[], index: number): number {
  const argument = args[index];
  if (argument === '--soak-duration') {
    const value = Number(optionValue(args, index, argument));
    if (!Number.isInteger(value) || value < 1_000) {
      throw new Error('--soak-duration must be an integer of at least 1000 ms.');
    }
    options.soakDurationMs = value;
  } else if (argument === '--profile') {
    const value = optionValue(args, index, argument);
    if (value !== 'desktop' && value !== 'mobile') {
      throw new Error(`--profile must be desktop or mobile, not "${value}".`);
    }
    options.profile = value;
  } else if (argument === '--scenario') {
    const value = optionValue(args, index, argument);
    const scenario = PERF_SCENARIO_LIST.find((candidate) => candidate.id === value);
    if (!scenario) throw new Error(`Unknown performance scenario: "${value}".`);
    options.scenarioId = scenario.id;
  } else if (argument === '--output') {
    options.output = optionValue(args, index, argument);
  } else if (argument === '--baseline') {
    options.baseline = optionValue(args, index, argument);
  } else {
    throw new Error(`Unknown performance option: ${argument}`);
  }
  return index + 1;
}

function initialOptions(): MutablePerfCliOptions {
  return {
    record: false,
    freezeBaseline: false,
    requireBaseline: false,
    skipBuild: false,
    smoke: false,
    profile: 'desktop',
    soak: false,
    soakDurationMs: 10 * 60 * 1_000,
    headless: false,
    help: false,
    firstSession: false,
    onboarding: false,
  };
}

export function parsePerfCliOptions(args: string[]): PerfCliOptions {
  const options = initialOptions();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (applyFlag(options, argument)) continue;
    index = applyValueOption(options, args, index);
  }

  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const defaultOutput = options.record
    ? resolve(APP_ROOT, PERF_DEFAULT_ARTIFACT_DIRECTORY, 'recorded', options.profile, timestamp)
    : resolve(APP_ROOT, PERF_DEFAULT_ARTIFACT_DIRECTORY, 'current', options.profile);

  return {
    record: options.record,
    freezeBaseline: options.freezeBaseline,
    outputDirectory: resolve(APP_ROOT, options.output ?? defaultOutput),
    baselinePath: options.baseline ? resolve(APP_ROOT, options.baseline) : undefined,
    requireBaseline:
      options.requireBaseline ||
      (!options.freezeBaseline &&
        !options.smoke &&
        !options.soak &&
        !(options.onboarding && !options.firstSession && !options.scenarioId)),
    skipBuild: options.skipBuild,
    smoke: options.smoke,
    profile: options.profile,
    scenarioId: options.scenarioId,
    soak: options.soak,
    soakDurationMs: options.soakDurationMs,
    headless: options.headless,
    help: options.help,
    firstSession: options.firstSession,
    onboarding: options.onboarding,
  };
}
