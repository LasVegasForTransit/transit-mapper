import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Production and test trees stay legible from filenames alone: source files
 * under `src/` are `<name>.<ext>`, tests under `tests/` are `<name>.test.ts(x)`,
 * `.spec.ts(x)` is reserved for end-to-end tests under `tests/e2e/`, and
 * test-only support lives under a `support/` (or `snapshots/`) directory.
 * `--staged` checks the exact tree being committed.
 */
const MODULE_FILE = /^(?:apps|packages)\/[^/]+\/(src|tests)\/(.+)$/;
const SOURCE_FILE = /^[^.]+\.[^.]+$/;
// Conventions that carry a second dot on purpose: CSS modules, tool config
// files (Astro requires src/content.config.ts), and placeholder files.
const CONVENTIONAL_SOURCE = /^(?:[^.]+\.(?:module\.[a-z]+|config\.[a-z]+)|\.gitkeep)$/;
// Documentation beside tests describes them and is not a suite.
const DOCUMENT = /^[A-Z][A-Z0-9-]*\.md$/;
// Astro routes files by name, and an endpoint such as src/pages/robots.txt.ts
// needs the extra dot to say what it serves.
const ROUTE_FILE = /^(?:apps|packages)\/[^/]+\/src\/pages\//;
// Test-only support (helpers, fixtures) and committed snapshots are not
// suites, so they take ordinary source names.
const SUPPORT_FILE = /^(?:.*\/)?(?:support|snapshots|[^/]+\.spec\.tsx?-snapshots)\//;
const TEST_FILE = /^[^.]+\.(test|spec)\.(ts|tsx)$/;

function exists(root, path) {
  try {
    lstatSync(resolve(root, path));
    return true;
  } catch {
    return false;
  }
}

function repositoryFiles(root, staged) {
  const args = staged
    ? ['ls-files', '--cached', '-z']
    : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'];
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((path) => staged || exists(root, path));
}

function violation(path) {
  const match = MODULE_FILE.exec(path);
  if (!match) return undefined;
  const [, tree, relative] = match;
  const filename = relative.split('/').at(-1) ?? '';

  if (tree === 'src') {
    return SOURCE_FILE.test(filename) || CONVENTIONAL_SOURCE.test(filename) || ROUTE_FILE.test(path)
      ? undefined
      : { path, expected: 'source files use exactly <name>.<extension>' };
  }
  if (DOCUMENT.test(filename)) return undefined;
  if (SUPPORT_FILE.test(relative)) {
    return SOURCE_FILE.test(filename) || /\.(?:png|jpe?g|webp|txt|json|snap)$/.test(filename)
      ? undefined
      : { path, expected: 'support and snapshot files use <name>.<extension>' };
  }
  if (!TEST_FILE.test(filename)) {
    return { path, expected: 'test files use exactly <name>.test.ts(x) or <name>.spec.ts(x)' };
  }
  const endToEnd = relative.startsWith('e2e/');
  const spec = /\.spec\.tsx?$/.test(filename);
  if (spec !== endToEnd) {
    return {
      path,
      expected: endToEnd
        ? 'end-to-end tests under tests/e2e/ use <name>.spec.ts(x)'
        : 'only end-to-end tests under tests/e2e/ use <name>.spec.ts(x)',
    };
  }
  return undefined;
}

export function checkFilenames({ cwd, staged = false }) {
  const violations = repositoryFiles(cwd, staged)
    .map(violation)
    .filter(Boolean)
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    name: 'filenames',
    ok: violations.length === 0,
    lines: violations.map(({ path, expected }) => `${path}\n      expected: ${expected}`),
    fix: 'rename each file to the expected form and update its imports',
  };
}
