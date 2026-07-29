#!/usr/bin/env tsx
/**
 * Keep production and test trees legible from filenames alone.
 *
 * The normal check sees tracked files plus non-ignored, untracked files in the
 * working tree. Pre-commit passes `--staged` so the exact tree being committed
 * is checked even when the working tree contains additional edits.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MODULE_FILE = /^(?:apps|packages)\/[^/]+\/(src|tests)\/(.+)$/;
const SOURCE_FILE = /^[^.]+\.[^.]+$/;
const TEST_FILE = /^[^.]+\.(test|spec)\.(ts|tsx)$/;

interface Violation {
  path: string;
  expected: string;
}

function existsInWorkingTree(path: string): boolean {
  try {
    lstatSync(resolve(ROOT, path));
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function repositoryFiles(staged: boolean): string[] {
  const args = staged
    ? ['ls-files', '--cached', '-z']
    : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'];
  const output = execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
  });

  return output
    .split('\0')
    .filter(Boolean)
    .filter((path) => staged || existsInWorkingTree(path));
}

function validate(path: string): Violation | undefined {
  const match = MODULE_FILE.exec(path);
  if (!match) return undefined;

  const [, tree, relativePath] = match;
  const filename = relativePath.split('/').at(-1) ?? '';
  if (tree === 'src') {
    if (SOURCE_FILE.test(filename)) return undefined;
    return {
      path,
      expected: 'source files use exactly <name>.<extension>',
    };
  }

  if (!TEST_FILE.test(filename)) {
    return {
      path,
      expected: 'test files use exactly <name>.test.ts(x) or <name>.spec.ts(x)',
    };
  }

  const isEndToEnd = relativePath.startsWith('e2e/');
  const isSpec = filename.endsWith('.spec.ts') || filename.endsWith('.spec.tsx');
  if (isSpec !== isEndToEnd) {
    return {
      path,
      expected: isEndToEnd
        ? 'end-to-end tests under tests/e2e/ use <name>.spec.ts(x)'
        : 'only end-to-end tests under tests/e2e/ use <name>.spec.ts(x)',
    };
  }

  return undefined;
}

function main(): void {
  const args = process.argv.slice(2);
  const unknown = args.filter((argument) => argument !== '--staged' && argument !== '--');
  if (unknown.length > 0) {
    console.error(`file names: unknown argument ${unknown.join(' ')}`);
    process.exit(2);
  }

  const violations = repositoryFiles(args.includes('--staged'))
    .map(validate)
    .filter((violation): violation is Violation => violation !== undefined)
    .sort((left, right) => left.path.localeCompare(right.path));

  if (violations.length === 0) {
    console.log('file names: source and test filenames are valid.');
    return;
  }

  console.error('\nfile names: source and test filenames are out of contract.\n');
  for (const violation of violations) {
    console.error(`  ${violation.path}`);
    console.error(`    expected: ${violation.expected}`);
  }
  console.error('\n  fix: rename each file to the expected form and update its imports\n');
  process.exit(1);
}

main();
