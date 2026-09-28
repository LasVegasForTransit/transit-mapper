import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
function allowedRange(name, range) {
  return (
    range.startsWith('catalog:') ||
    range.startsWith('workspace:') ||
    (/^@lasvegasfortransit\/[a-z0-9-]+$/.test(name) && /^\d+\.\d+\.\d+$/.test(range)) ||
    range.startsWith('link:')
  );
}

function vendoredRange(root, directory, name, range) {
  if (!/^@lasvegasfortransit\/[a-z0-9-]+$/.test(name) || !range.startsWith('file:')) return false;
  const expected = path.resolve(
    root,
    '.lvbt/web-platform/packages',
    name.slice('@lasvegasfortransit/'.length),
  );
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

// Astro loads its configuration from the first of these it finds in the project's root.
const ASTRO_CONFIGS = ['mjs', 'js', 'ts', 'mts', 'cjs', 'cts'].map((ext) => `astro.config.${ext}`);

/**
 * An Astro project depends on astro and has its own configuration. A library that only imports
 * Astro's types, such as an integration or components, has nothing for `astro sync` to generate.
 */
function isAstroProject(root, directory, manifest) {
  if (!manifest.dependencies?.astro && !manifest.devDependencies?.astro) return false;
  return ASTRO_CONFIGS.some((name) => existsSync(path.join(root, directory, name)));
}

/**
 * An Astro package generates its `astro:content` and environment types with `astro sync`. On a
 * clean checkout, as in CI, those types don't exist until it runs, and type-aware lint rules fail
 * on every module that imports them. So each Astro package declares a `sync` script, and the root
 * turbo.json runs it before `lint`.
 */
function astroFailures(root, directories) {
  const failures = [];
  let astro = false;
  for (const directory of directories) {
    const manifest = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
    if (!isAstroProject(root, directory, manifest)) continue;
    astro = true;
    if (!manifest.scripts?.sync) {
      failures.push(
        `${directory}/package.json has no "sync" script to generate Astro's types before lint`,
      );
    }
  }
  if (!astro) return [];
  let turbo;
  try {
    turbo = JSON.parse(readFileSync(path.join(root, 'turbo.json'), 'utf8'));
  } catch {
    return [...failures, 'turbo.json is missing or not plain JSON, so lint cannot run after sync'];
  }
  if (!turbo.tasks?.sync) failures.push('turbo.json has no "sync" task');
  if (!turbo.tasks?.lint?.dependsOn?.includes('sync')) {
    failures.push('turbo.json does not run "sync" before "lint"');
  }
  return failures;
}

function dependencyFailures(root, directory) {
  const manifest = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
  const failures = [];
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (!allowedRange(name, range) && !vendoredRange(root, directory, name, range)) {
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
  const directories = packageDirectories(cwd);
  for (const directory of ['.', ...directories]) {
    if (directory !== '.') lines.push(...packageFailures(cwd, directory));
    lines.push(...dependencyFailures(cwd, directory));
  }
  lines.push(...astroFailures(cwd, directories));
  return {
    name: 'contract',
    ok: lines.length === 0,
    lines,
    fix: 'add the missing script, move test material under tests/, set the range to "catalog:" and add the version to pnpm-workspace.yaml, or run `pnpm standards:update` to wire an Astro package\'s "sync" task before lint',
  };
}
