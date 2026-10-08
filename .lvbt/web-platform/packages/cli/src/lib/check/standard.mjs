import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readTooling } from '../tooling.mjs';
import { turboCacheProblem, turboCacheRequired } from './turbo-cache.mjs';

export const STANDARD_COMMANDS = {
  bootstrap: 'lvbt bootstrap',
  preflight: 'lvbt preflight',
  check:
    'pnpm format:check && markdownlint-cli2 && lvbt check && turbo run lint check-types test validate',
  audit: 'lvbt audit',
};
export function standardCommands(cwd) {
  return standardCommandsFor({
    vendored: existsSync(path.join(cwd, '.lvbt/web-platform/packages/cli/src/cli.mjs')),
  });
}
export function standardCommandsFor({ vendored = false } = {}) {
  if (!vendored) return STANDARD_COMMANDS;
  const prefix = 'node .lvbt/web-platform/packages/cli/src/cli.mjs';
  return {
    ...STANDARD_COMMANDS,
    bootstrap: `${prefix} bootstrap`,
    preflight: `${prefix} preflight`,
  };
}
export async function checkStandard({ cwd }) {
  const lines = [];
  let ok = true;
  let release = null;
  try {
    readTooling(cwd);
  } catch (error) {
    lines.push(error.message);
    ok = false;
  }
  const file = path.join(cwd, 'package.json');
  const pkg = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  lines.push(...commandWarnings(cwd, pkg));
  const warning = workspaceWarning(cwd);
  if (warning) lines.push(warning);
  if (existsSync(path.join(cwd, '.lvbt/web-platform.json'))) {
    try {
      const vendor = path.join(cwd, '.lvbt/web-platform/standards');
      const { verifyPreset } = await import(
        pathToFileURL(path.join(vendor, 'web-platform.ts')).href
      );
      const { ownedFileDrift } = await import(
        pathToFileURL(path.join(vendor, 'owned-files.ts')).href
      );
      const metadata = await verifyPreset(cwd);
      release = metadata.release;
      const drift = await ownedFileDrift(cwd, metadata.release);
      if (drift.length) {
        lines.push(...drift);
        ok = false;
      }
      if (metadata.release === null)
        lines.push(
          'warning: this standard is an unpublished snapshot; adopt the published release after consumer validation.',
        );
    } catch (error) {
      lines.push(error.message);
      ok = false;
    }
  }
  const cache = cacheCheck(cwd, release);
  lines.push(...cache.lines);
  ok = ok && cache.ok;
  return {
    name: 'standard',
    ok,
    lines,
    fix: 'Run pnpm standards:update for shared files; make shared behavior changes in repository-tooling, then migrate application-owned configuration.',
  };
}

function cacheCheck(cwd, release) {
  const turbo = path.join(cwd, 'turbo.json');
  const problem = turboCacheProblem(existsSync(turbo) ? readFileSync(turbo, 'utf8') : null);
  const required = turboCacheRequired(release);
  return {
    ok: !problem || !required,
    lines: problem ? [`${required ? 'error' : 'warning'}: ${problem} (required from v0.8.0).`] : [],
  };
}

function workspaceWarning(cwd) {
  const workspace = path.join(cwd, 'pnpm-workspace.yaml');
  if (
    existsSync(workspace) &&
    !/^(?:verifyDepsBeforeRun|'verifyDepsBeforeRun'|"verifyDepsBeforeRun")\s*:\s*false(?:\s*#.*)?\s*$/mu.test(
      readFileSync(workspace, 'utf8'),
    )
  )
    return 'warning: set verifyDepsBeforeRun: false in pnpm-workspace.yaml so preflight cannot auto-install (pnpm 11 ignores this setting in .npmrc).';
}

function commandWarnings(cwd, pkg) {
  if (pkg.name === 'lvbt-repository-tooling') return [];
  return Object.entries(standardCommands(cwd)).flatMap(([name, command]) =>
    pkg.scripts?.[name] === command
      ? []
      : [
          `warning: root ${name} must be "${command}"; adopt the shared command and move application steps into the standard extension points (required from v0.8.0).`,
        ],
  );
}
