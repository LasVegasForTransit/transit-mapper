#!/usr/bin/env tsx
/**
 * Every tool that gets configured here gets configured the same way.
 *
 * The repository arrived at `<tool>.config.<ext>` on its own — `vite.config.ts`,
 * five `vitest.config.ts`, `perf.config.ts`, `turbo/generators/config.ts` — and
 * then drifted, because nothing said so. `eslint.config.js` stayed JavaScript
 * while everything around it became TypeScript, and Prettier kept the
 * `.prettierrc.json` name it was born with. Neither was a decision; both were
 * just what the tool's quickstart printed.
 *
 * That matters more than the two files do. Every new tool arrives with its own
 * default filename and its own preferred format, and a repository that accepts
 * each default ends up with a root nobody can predict: is it `.foorc`,
 * `foo.json`, `.config/foo.yaml`? Somebody looking for a setting has to know
 * the tool before they can find the file.
 *
 * So there is one shape, and three rules enforce it:
 *
 *   1. No `.toolrc` names. They are the old convention and they carry no
 *      extension signal, so an editor cannot even syntax-highlight them.
 *   2. `<tool>.config.<ext>` is TypeScript, unless the tool genuinely cannot
 *      load TypeScript. Those tools are listed below with the reason, so the
 *      exemption is a decision somebody made rather than a default nobody
 *      questioned.
 *   3. A data file sitting at a scanned root is either that shape or on the
 *      list of names their own tools define and nobody can rename.
 *
 * Rule 3 is the one that catches the next tool. `knip.json` and `.jscpd.json`
 * are both what their quickstarts print, and both fail here.
 *
 * Scanned roots are the repository root and every directory holding a
 * `package.json`, taken from `git ls-files` so ignored and untracked debris
 * cannot fail a build. Only the immediate children of each root are considered:
 * a `.json` deeper in a tree is data or a fixture, not configuration.
 *
 * Usage: `pnpm check:config` — exit 0 = the convention holds, exit 1 = it does not.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Extensions that make a root-level file configuration rather than source.
 * Code files are excluded on purpose: an `index.ts` at a package root is a
 * module, and rule 3 has no business judging it.
 */
const DATA_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'toml']);

/** The old convention: `.prettierrc`, `.babelrc.json`, `.eslintrc.cjs`. */
const RC_NAME = /^\.[a-z0-9-]+rc(\.[a-z]+)?$/i;

/** `<tool>.config.<ext>`, capturing the tool and the extension. */
const CONFIG_NAME = /^(?<tool>[a-z0-9][a-z0-9.-]*)\.config\.(?<ext>[a-z]+)$/i;

interface Exemption {
  /** The `<tool>` part of the filename. */
  tool: string;
  /** The one extension this tool is allowed to use instead of `ts`. */
  ext: string;
  why: string;
}

/**
 * Tools that cannot load a TypeScript config, with the reason each cannot.
 * Adding an entry is the deliberate act; the default is TypeScript.
 */
const NOT_TYPESCRIPT: Exemption[] = [
  {
    tool: 'prettier',
    ext: 'mjs',
    why: 'Prettier ships zero dependencies and registers no TypeScript loader.',
  },
];

/** Names a tool defines for itself, valid at any scanned root. */
const TOOL_OWNED = [
  /^package\.json$/,
  // TypeScript resolves `extends` and `--project` by these names.
  /^tsconfig(\.[a-z0-9-]+)?\.json$/,
  /^turbo\.json$/,
  /^wrangler\.toml$/,
  // ESLint's suppression ledger, written by `--suppress-all` and read from the
  // working directory. Every package lints from its own directory, so every
  // package that carries debt has one. Pointing them all at a single shared
  // file would mean repeating --suppressions-location in each `lint` script,
  // and one missed copy silently reads an empty ledger.
  /^eslint-suppressions\.json$/,
];

/**
 * Repository-relative paths a tool defines and nobody can rename. Path-scoped
 * rather than name-scoped so a stray `pnpm-lock.yaml` inside a package still
 * fails.
 */
const OWNED_PATHS = new Set([
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  '.gitleaks.toml',
  // release-please reads both by these exact names, passed nowhere.
  'release-please-config.json',
  '.release-please-manifest.json',
  // A shared tsconfig fragment other packages reach by
  // `@transitmapper/tsconfig/base.json`. Renaming it means editing every
  // `extends` in the workspace for no gain.
  'packages/tsconfig/base.json',
]);

interface Offence {
  path: string;
  problem: string;
  fix: string;
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function basename(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

function dirname(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

function extension(name: string): string {
  const cut = name.lastIndexOf('.');
  return cut <= 0 ? '' : name.slice(cut + 1).toLowerCase();
}

function judge(path: string): Offence | undefined {
  const name = basename(path);

  if (RC_NAME.test(name)) {
    const tool = name.slice(1).replace(/rc(\.[a-z]+)?$/i, '');
    return {
      path,
      problem: 'uses the old `.toolrc` convention',
      fix: `rename it to ${tool}.config.ts, or add ${tool} to NOT_TYPESCRIPT in this script`,
    };
  }

  const shaped = CONFIG_NAME.exec(name);
  if (shaped?.groups) {
    const { tool, ext } = shaped.groups;
    if (ext.toLowerCase() === 'ts') return undefined;
    const exempt = NOT_TYPESCRIPT.find((e) => e.tool === tool.toLowerCase());
    if (!exempt) {
      return {
        path,
        problem: `is a ${ext} config where the convention is TypeScript`,
        fix: `rewrite it as ${tool}.config.ts, or add ${tool} to NOT_TYPESCRIPT in this script with the reason it cannot`,
      };
    }
    if (exempt.ext !== ext.toLowerCase()) {
      return {
        path,
        problem: `is a ${ext} config where NOT_TYPESCRIPT records ${tool} as ${exempt.ext}`,
        fix: `rename it to ${tool}.config.${exempt.ext}, or update the entry in this script`,
      };
    }
    return undefined;
  }

  if (OWNED_PATHS.has(path)) return undefined;
  if (TOOL_OWNED.some((pattern) => pattern.test(name))) return undefined;
  if (!DATA_EXTENSIONS.has(extension(name))) return undefined;

  const tool = name.replace(/\.[a-z]+$/i, '');
  return {
    path,
    problem: 'is configuration under a name only its own tool knows',
    fix: `rename it to ${tool}.config.ts, or add it to OWNED_PATHS in this script if the tool cannot read any other name`,
  };
}

function main(): void {
  const tracked = git(['ls-files']).split('\n').filter(Boolean);

  // A directory holding a package.json is a module root. The repository root
  // holds one too, so this covers it without a special case.
  const roots = new Set(
    tracked.filter((p) => basename(p) === 'package.json').map((p) => dirname(p)),
  );

  const offences: Offence[] = [];
  for (const path of tracked) {
    if (!roots.has(dirname(path))) continue;
    const offence = judge(path);
    if (offence) offences.push(offence);
  }

  if (offences.length > 0) {
    console.error('\nconfig: a tool is configured under a name the repository does not use.\n');
    for (const o of offences) {
      console.error(`  ${o.path} ${o.problem}`);
      console.error(`    fix: ${o.fix}`);
    }
    console.error(
      '\n  Every tool config is `<tool>.config.<ext>` at the root of what it' +
        '\n  configures, and `<ext>` is `ts` unless the tool cannot load it.' +
        '\n  See docs/development/explanation/enforcement-model.md#config-shape\n',
    );
    process.exit(1);
  }

  console.log(`config: ${roots.size} module roots, every tool config in the one shape.`);
}

main();
