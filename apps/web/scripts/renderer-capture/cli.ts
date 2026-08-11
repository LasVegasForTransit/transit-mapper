import { resolve } from 'node:path';
import type { PerfProfileId } from '../../src/perf/types';
import type { RendererCaptureTheme } from '../../src/perf/renderer-capture';

export interface RendererCaptureCliOptions {
  phase: string;
  profile: PerfProfileId | 'all';
  theme: RendererCaptureTheme | 'all';
  skipBuild: boolean;
  outputDirectory: string;
  help: boolean;
}

const APP_ROOT = resolve(import.meta.dirname, '../..');
export const RENDERER_CAPTURE_ARTIFACT_ROOT = resolve(APP_ROOT, 'artifacts/renderer');

interface RendererCaptureCliState {
  phase?: string;
  profile: RendererCaptureCliOptions['profile'];
  theme: RendererCaptureCliOptions['theme'];
  skipBuild: boolean;
  help: boolean;
}

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

export function rendererCaptureUsage(): string {
  return [
    'Usage: pnpm renderer:capture -- --phase <name> [options]',
    '',
    'Options:',
    '  --phase <name>       Stable artifact label such as 00-baseline',
    '  --profile <profile>  all (default), desktop, or mobile',
    '  --theme <theme>      all (default), light, or dark',
    '  --skip-build         Reuse the current instrumented dist output',
    '  --help               Show this help',
  ].join('\n');
}

function parseProfile(value: string): RendererCaptureCliOptions['profile'] {
  if (value === 'all' || value === 'desktop' || value === 'mobile') return value;
  throw new Error(`--profile must be all, desktop, or mobile, not "${value}".`);
}

function parseTheme(value: string): RendererCaptureCliOptions['theme'] {
  if (value === 'all' || value === 'light' || value === 'dark') return value;
  throw new Error(`--theme must be all, light, or dark, not "${value}".`);
}

function applyValueOption(state: RendererCaptureCliState, argument: string, value: string): void {
  if (argument === '--phase') state.phase = value;
  else if (argument === '--profile') state.profile = parseProfile(value);
  else if (argument === '--theme') state.theme = parseTheme(value);
  else throw new Error(`Unknown renderer capture option: ${argument}`);
}

export function parseRendererCaptureCliOptions(args: string[]): RendererCaptureCliOptions {
  const state: RendererCaptureCliState = {
    profile: 'all',
    theme: 'all',
    skipBuild: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--skip-build') state.skipBuild = true;
    else if (argument === '--help') state.help = true;
    else if (argument === '--phase' || argument === '--profile' || argument === '--theme') {
      applyValueOption(state, argument, optionValue(args, index, argument));
      index += 1;
    } else {
      throw new Error(`Unknown renderer capture option: ${argument}`);
    }
  }

  if (!state.help && !state.phase) throw new Error('--phase is required.');
  const phase = state.phase ?? 'help';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(phase)) {
    throw new Error('--phase must contain only lowercase letters, numbers, and hyphens.');
  }
  const complete = state.profile === 'all' && state.theme === 'all';
  const artifactName = complete ? phase : `diagnostic-${phase}-${state.profile}-${state.theme}`;

  return {
    phase,
    profile: state.profile,
    theme: state.theme,
    skipBuild: state.skipBuild,
    outputDirectory: resolve(RENDERER_CAPTURE_ARTIFACT_ROOT, artifactName),
    help: state.help,
  };
}
