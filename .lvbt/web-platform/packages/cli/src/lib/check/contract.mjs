import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Every workspace package declares the tasks the standard runs, every
 * dependency version comes from the catalog, and test material lives under
 * the owning package's tests/. A package missing a task is skipped by Turborepo
 * without an error, so CI stays green while the package goes unchecked.
 */
const REQUIRED_TASKS = ['lint', 'check-types', 'test'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const TEST_DIRECTORIES = new Set(['test', 'tests', 'testing', '__tests__']);
// Build, cache, and report output is never source or test material.
const IGNORED = new Set([
  'node_modules',
  'dist',
  'dist-archive',
  'coverage',
  'playwright-report',
  'test-results',
  '.turbo',
  '.wrangler',
  '.astro',
]);

/** Version specifiers the standard permits besides the catalog. */
function allowedRange(range) {
  return (
    range.startsWith('catalog:') ||
    range.startsWith('workspace:') ||
    range.startsWith('github:LasVegasForTransit/repository-tooling#') ||
    range.startsWith('link:')
  );
}

function vendoredRange(root, directory, name, range) {
  if (!/^@lvbt\/[a-z0-9-]+$/.test(name) || !range.startsWith('file:')) return false;
  const expected = path.resolve(root, '.lvbt/web-platform/packages', name.slice('@lvbt/'.length));
  if (path.resolve(root, directory, range.slice('file:'.length)) !== expected) return false;
  try {
    return JSON.parse(readFileSync(path.join(expected, 'package.json'), 'utf8')).name === name;
  } catch {
    return false;
  }
}

/** `packages:` globs from pnpm-workspace.yaml, without a YAML dependency. */
function workspaceGlobs(root) {
  const text = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const globs = [];
  let inPackages = false;
  for (const line of text.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\s+-\s+/.test(line)) {
      globs.push(line.replace(/^\s+-\s+/, '').replace(/^['"]|['"]$/g, ''));
    } else if (inPackages && /^\S/.test(line)) {
      break;
    }
  }
  return globs;
}

function packageDirectories(root) {
  const directories = [];
  for (const glob of workspaceGlobs(root)) {
    if (glob.endsWith('/*')) {
      const parent = path.join(root, glob.slice(0, -2));
      if (!statSync(parent, { throwIfNoEntry: false })?.isDirectory()) continue;
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          directories.push(path.join(glob.slice(0, -2), entry.name));
        }
      }
    } else if (statSync(path.join(root, glob), { throwIfNoEntry: false })?.isDirectory()) {
      directories.push(glob);
    }
  }
  return directories.filter((directory) =>
    statSync(path.join(root, directory, 'package.json'), { throwIfNoEntry: false }),
  );
}

function files(root, directory) {
  const found = [];
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(root, directory, relative), {
      withFileTypes: true,
    })) {
      if (IGNORED.has(entry.name)) continue;
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next);
      else found.push(next);
    }
  };
  walk('');
  return found;
}

function packageFailures(root, directory) {
  const manifest = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
  const failures = [];
  const contents = files(root, directory);
  const shipsCode = contents.some((file) => SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext)));

  if (shipsCode) {
    for (const task of REQUIRED_TASKS) {
      if (!manifest.scripts?.[task]) {
        failures.push(`${directory}/package.json has no "${task}" script`);
      }
    }
  }
  for (const file of contents) {
    const parts = file.split('/');
    const looksLikeTest =
      TEST_FILE.test(parts.at(-1) ?? '') ||
      parts.slice(0, -1).some((part) => TEST_DIRECTORIES.has(part));
    if (looksLikeTest && parts[0] !== 'tests') {
      failures.push(`${directory} keeps test material outside tests/: ${file}`);
    }
  }
  return failures;
}

function dependencyFailures(root, directory) {
  const manifest = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
  const failures = [];
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (!allowedRange(range) && !vendoredRange(root, directory, name, range)) {
        failures.push(
          `${directory}/package.json pins "${name}" to "${range}" instead of "catalog:"`,
        );
      }
    }
  }
  return failures;
}

export function checkContract({ cwd }) {
  const lines = [];
  for (const directory of ['.', ...packageDirectories(cwd)]) {
    if (directory !== '.') lines.push(...packageFailures(cwd, directory));
    lines.push(...dependencyFailures(cwd, directory));
  }
  return {
    name: 'contract',
    ok: lines.length === 0,
    lines,
    fix: 'add the missing script, move test material under tests/, or set the range to "catalog:" and add the version to pnpm-workspace.yaml',
  };
}
