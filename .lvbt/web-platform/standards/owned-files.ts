import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { WebPreset } from './web-platform.ts';

/**
 * Files every repository copies from the example and never edits: the adoption guide's "copy these,
 * overwriting your versions" list. `standards:check` warns when one differs from the vendored
 * release; from v0.6.0 it fails, and the update restores the standard's copy.
 */
export const OWNED_FILES = [
  '.githooks/commit-msg',
  '.githooks/pre-commit',
  '.githooks/pre-push',
  '.githooks/prepare-commit-msg',
  '.codex/hooks.json',
  '.agents/plugins/marketplace.json',
  '.github/actions/setup-node-pnpm/action.yml',
  '.editorconfig',
];

/**
 * Files the updater adds when a repository lacks them but never rewrites. A repository's own
 * workflow token may not change workflow files, so rewriting one would block every self-update.
 */
export const SEEDED_FILES = ['.github/workflows/standard-update.yml'];

/** Every example carries the same owned files; the Astro example is the vendored reference. */
const REFERENCE = 'examples/with-astro';

// Prettier reads these before prettier.config.js, so any of them silently replaces the org rules.
const SHADOWING_PRETTIER_CONFIGS = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.json5',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  '.prettierrc.ts',
  '.prettierrc.toml',
];

const SETTINGS = '.claude/settings.json';
const MARKETPLACE_REF =
  /("repo"\s*:\s*"LasVegasForTransit\/repository-tooling"\s*,\s*"ref"\s*:\s*")([^"]*)(")/;

async function readOptional(file: string): Promise<string | null> {
  return readFile(file, 'utf8').catch(() => null);
}

async function isExecutable(file: string): Promise<boolean> {
  return ((await stat(file)).mode & 0o111) !== 0;
}

/** Adds each seeded file the repository lacks, from the incoming release. */
export async function seedFiles(
  root: string,
  bundle: WebPreset,
  dryRun: boolean,
): Promise<string[]> {
  const added: string[] = [];
  for (const name of SEEDED_FILES) {
    const reference = `${REFERENCE}/${name}`;
    const content = bundle.files[reference];
    const file = path.join(root, name);
    if (content === undefined || (await readOptional(file)) !== null) continue;
    added.push(name);
    if (dryRun) continue;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    if (bundle.executables?.includes(reference)) await chmod(file, 0o755);
  }
  return added;
}

/**
 * Points the Claude Code contribution plugin at the release being installed. A repository without
 * a settings file gets the example's; one that pins another marketplace keeps its own.
 */
export async function syncPluginRef(
  root: string,
  bundle: WebPreset,
  dryRun: boolean,
): Promise<string[]> {
  if (!bundle.release) return [];
  const file = path.join(root, SETTINGS);
  const current = await readOptional(file);
  let next: string | undefined;
  if (current === null) next = bundle.files[`${REFERENCE}/${SETTINGS}`];
  else if (MARKETPLACE_REF.test(current))
    next = current.replace(MARKETPLACE_REF, `$1${bundle.release}$3`);
  if (next === undefined || next === current) return [];
  if (!dryRun) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, next);
  }
  return [SETTINGS];
}

async function ownedFileProblem(root: string, name: string): Promise<string | undefined> {
  const vendored = path.join(root, '.lvbt/web-platform', REFERENCE, name);
  const expected = await readOptional(vendored);
  if (expected === null) return undefined;
  const actual = await readOptional(path.join(root, name));
  if (actual === null) return `${name} is missing.`;
  if (actual !== expected) return `${name} differs from the standard's copy.`;
  if ((await isExecutable(vendored)) && !(await isExecutable(path.join(root, name))))
    return `${name} is not executable.`;
  return undefined;
}

/** What `standards:check` reports: files the standard owns that the repository changed. */
export async function ownedFileDrift(root: string, release: string | null): Promise<string[]> {
  const problems: string[] = [];
  for (const name of OWNED_FILES) {
    const problem = await ownedFileProblem(root, name);
    if (problem) problems.push(problem);
  }
  if ((await readOptional(path.join(root, 'prettier.config.js'))) !== null) {
    for (const name of SHADOWING_PRETTIER_CONFIGS)
      if ((await readOptional(path.join(root, name))) !== null)
        problems.push(`${name} replaces the organization's prettier.config.js.`);
  }
  if (release) {
    const settings = await readOptional(path.join(root, SETTINGS));
    const ref = settings ? MARKETPLACE_REF.exec(settings)?.[2] : undefined;
    if (ref !== undefined && ref !== release)
      problems.push(`${SETTINGS} loads the contribution plugin from ${ref}, not ${release}.`);
  }
  return problems;
}
