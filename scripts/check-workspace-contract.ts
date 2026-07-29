#!/usr/bin/env tsx
/**
 * Every workspace package must declare every task the repository's
 * enforcement depends on.
 *
 * A package missing one is skipped by Turborepo without an error, so CI
 * stays green while the package goes unchecked. That is not hypothetical:
 * apps/worker declared no test script, and the Worker — the only component
 * touching D1, cookies and untrusted input — reached production with zero
 * coverage and nothing reporting it.
 *
 * The package list comes from `turbo query` rather than from parsing
 * pnpm-workspace.yaml, so this agrees with the build graph by construction
 * instead of by coincidence.
 */
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const TEST_DIRECTORIES = new Set(['test', 'tests', 'testing', '__tests__']);
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', '.turbo', '.wrangler', 'artifacts']);

/**
 * Whether a package ships code at all.
 *
 * A package of pure configuration — `packages/tsconfig` holds only JSON — has
 * nothing to lint, typecheck, or run. Demanding the three scripts anyway gets
 * answered with three scripts that do nothing, and the reasoning that keeps
 * `build` off the required list applies unchanged: a task written to satisfy
 * a check is a lie, and the next reader cannot tell it from a real one.
 *
 * Detected rather than declared. A field in package.json saying "the contract
 * does not apply to me" would be reached for by any package that found the
 * contract inconvenient; adding one source file here re-imposes it with no
 * decision required.
 */
async function shipsCode(path: string): Promise<boolean> {
  const entries = await readdir(resolve(ROOT, path), { recursive: true, withFileTypes: true });
  return entries.some(
    (e) =>
      e.isFile() &&
      !e.parentPath.includes('node_modules') &&
      !e.parentPath.includes('dist') &&
      SOURCE_EXTENSIONS.some((ext) => e.name.endsWith(ext)),
  );
}

function packageRelativePath(packagePath: string, parentPath: string, name: string): string {
  return relative(resolve(ROOT, packagePath), resolve(parentPath, name)).replaceAll('\\', '/');
}

function canonicalPackagePath(packagePath: string, entry: string): string {
  const packageRoot = resolve(ROOT, packagePath);
  return relative(packageRoot, resolve(packageRoot, entry)).replaceAll('\\', '/');
}

function workspacePath(packagePath: string, entry: string): string {
  return relative(ROOT, resolve(ROOT, packagePath, entry)).replaceAll('\\', '/');
}

async function misplacedTestMaterial(packagePath: string): Promise<string[]> {
  const entries = await readdir(resolve(ROOT, packagePath), {
    recursive: true,
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => packageRelativePath(packagePath, entry.parentPath, entry.name))
    .filter((path) => {
      const parts = path.split('/');
      if (parts.some((part) => IGNORED_DIRECTORIES.has(part))) return false;
      const directoryLooksLikeTests = parts.slice(0, -1).some((part) => TEST_DIRECTORIES.has(part));
      return (
        (TEST_FILE.test(parts.at(-1) ?? '') || directoryLooksLikeTests) && parts[0] !== 'tests'
      );
    })
    .sort();
}

const SHELL_OPERATORS = new Set([';', '&', '&&', '|', '||', '\n', '(', ')']);

interface ShellToken {
  value: string;
  isStatic: boolean;
}

function shellTokens(command: string): ShellToken[] | undefined {
  const tokens: ShellToken[] = [];
  let token = '';
  let tokenIsStatic = true;
  let quote: "'" | '"' | undefined;
  let escaped = false;

  const pushToken = (): void => {
    if (token.length === 0) return;
    tokens.push({ value: token, isStatic: tokenIsStatic });
    token = '';
    tokenIsStatic = true;
  };

  const pushOperator = (value: string): void => {
    tokens.push({ value, isStatic: true });
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else if (character === '\\' && quote === '"') {
        escaped = true;
      } else {
        if (quote === '"' && (character === '$' || character === '`')) {
          tokenIsStatic = false;
        }
        token += character;
      }
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '\n') {
      pushToken();
      pushOperator(character);
      continue;
    }
    if (/\s/.test(character)) {
      pushToken();
      continue;
    }
    if (
      character === ';' ||
      character === '&' ||
      character === '|' ||
      character === '(' ||
      character === ')'
    ) {
      pushToken();
      const next = command[index + 1];
      if ((character === '&' || character === '|') && next === character) {
        pushOperator(`${character}${next}`);
        index += 1;
      } else {
        pushOperator(character);
      }
      continue;
    }
    if (
      character === '$' ||
      character === '`' ||
      character === '*' ||
      character === '?' ||
      character === '[' ||
      character === '{' ||
      (character === '~' && token.length === 0)
    ) {
      tokenIsStatic = false;
    }
    token += character;
  }

  if (quote || escaped) return undefined;
  pushToken();
  return tokens;
}

interface DirectVerifyDiscovery {
  entries: string[];
  unverifiable: string[];
}

function directVerifyEntries(command: string): DirectVerifyDiscovery {
  const tokens = shellTokens(command);
  if (!tokens) {
    return {
      entries: [],
      unverifiable: command.includes('tsx') ? [command] : [],
    };
  }

  const entries: string[] = [];
  const unverifiable: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== 'tsx') continue;

    const end = tokens.findIndex(
      (token, tokenIndex) => tokenIndex > index && SHELL_OPERATORS.has(token.value),
    );
    const commandEnd = end === -1 ? tokens.length : end;
    const args = tokens.slice(index + 1, commandEnd);
    const rendered = ['tsx', ...args.map((argument) => argument.value)].join(' ');
    let argument = 0;

    while (argument < args.length && args[argument].value.startsWith('-')) {
      const option = args[argument].value;
      if (option === '--') {
        argument += 1;
        break;
      }
      if (option === '--tsconfig') {
        argument += 2;
        continue;
      }
      if (option.startsWith('--tsconfig=') && option.length > '--tsconfig='.length) {
        argument += 1;
        continue;
      }
      unverifiable.push(rendered);
      argument = args.length;
      break;
    }

    const entry = args[argument];
    if (entry?.isStatic && /\.[cm]?[jt]sx?$/.test(entry.value)) {
      entries.push(entry.value);
    } else if (!unverifiable.includes(rendered)) {
      unverifiable.push(rendered);
    }
    index = commandEnd - 1;
  }

  return { entries, unverifiable };
}

/**
 * Tasks every package must define. `build` is deliberately absent: a
 * package that ships raw TypeScript source has nothing to build, and
 * requiring an empty build script would teach people to write lies.
 */
const REQUIRED_TASKS = ['lint', 'typecheck', 'verify'] as const;

interface TurboPackage {
  name: string;
  path: string;
}

interface TurboQueryResponse {
  data: { packages: { items: TurboPackage[] } };
}

function listPackages(): TurboPackage[] {
  const raw = execFileSync(
    'npx',
    ['turbo', 'query', 'query { packages { items { name path } } }'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  // turbo prints a version banner before the JSON body.
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'))) as TurboQueryResponse;
  // "//" is the workspace root. It orchestrates tasks rather than defining
  // them, so the contract does not apply to it.
  return parsed.data.packages.items.filter((p) => p.name !== '//');
}

interface Manifest {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface Failure {
  /** Groups failures so each kind prints its own remediation. */
  kind: 'task' | 'catalog' | 'test-layout';
  message: string;
}

/** What to tell someone for each kind of failure. Every failure names the
 *  fix for *that* failure; a generic footer sends people down the wrong path. */
const REMEDIATION: Record<Failure['kind'], string> = {
  task:
    '  Turborepo skips a package that does not define the task, without an error.\n' +
    '  fix:  add the missing script to that package.json',
  catalog:
    '  fix:  set the range to "catalog:", add it under `catalog:` in\n' +
    '        pnpm-workspace.yaml, then run `pnpm install`',
  'test-layout':
    "  Tests and test-only support belong under the owning package's tests/ directory.\n" +
    '  fix:  move each path to <package>/tests/, mirror its source area, and update imports',
};

async function main(): Promise<void> {
  const failures: Failure[] = [];

  // The root package is checked for dependency declarations but not for
  // tasks: it orchestrates them rather than defining them.
  const manifests: { name: string; path: string; manifest: Manifest }[] = [];
  for (const pkg of [{ name: 'the workspace root', path: '.' }, ...listPackages()]) {
    manifests.push({
      ...pkg,
      manifest: JSON.parse(
        await readFile(resolve(ROOT, pkg.path, 'package.json'), 'utf8'),
      ) as Manifest,
    });
  }

  for (const { name, path, manifest } of manifests) {
    if (path !== '.') {
      const scripts = manifest.scripts ?? {};
      if (await shipsCode(path)) {
        for (const task of REQUIRED_TASKS) {
          if (!scripts[task]) {
            failures.push({
              kind: 'task',
              message: `${name} (${path}/package.json) has no "${task}" script`,
            });
          }
        }
      }

      const misplacedTests = new Set(await misplacedTestMaterial(path));
      const directVerifiers = directVerifyEntries(scripts.verify ?? '');

      for (const entry of directVerifiers.entries) {
        const canonical = canonicalPackagePath(path, entry);
        if (canonical === 'tests' || canonical.startsWith('tests/')) continue;
        misplacedTests.add(canonical);
      }

      for (const misplaced of [...misplacedTests].sort()) {
        failures.push({
          kind: 'test-layout',
          message: `${name} keeps test material outside ${path}/tests/: ${workspacePath(path, misplaced)}`,
        });
      }

      for (const command of [...new Set(directVerifiers.unverifiable)].sort()) {
        failures.push({
          kind: 'test-layout',
          message: `${name} has an unverifiable direct tsx command in ${path}/package.json verify: ${command}`,
        });
      }
    }

    // Every external dependency resolves through the catalog in
    // pnpm-workspace.yaml, so two packages cannot drift onto different
    // versions of the same library without that showing up as a change to
    // one shared file.
    for (const field of ['dependencies', 'devDependencies'] as const) {
      for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
        if (range.startsWith('catalog:') || range.startsWith('workspace:')) continue;
        failures.push({
          kind: 'catalog',
          message: `${name} (${path}/package.json) pins "${dep}" to "${range}" instead of "catalog:"`,
        });
      }
    }
  }

  if (failures.length > 0) {
    console.error('\nworkspace contract: the repository is out of contract.');
    for (const kind of ['task', 'catalog', 'test-layout'] as const) {
      const group = failures.filter((f) => f.kind === kind);
      if (group.length === 0) continue;
      console.error('');
      for (const f of group) console.error(`  ${f.message}`);
      console.error('');
      console.error(REMEDIATION[kind]);
    }
    console.error('');
    process.exit(1);
  }

  console.log(
    'workspace contract: package tasks, dependency versions, and test layouts are valid.',
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
