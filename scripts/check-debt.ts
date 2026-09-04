#!/usr/bin/env tsx
/**
 * Suppressed lint debt only ever shrinks.
 *
 * `eslint --suppress-all` freezes existing violations as a count per file per
 * rule, which is what let this repository turn on rules that report 1,351
 * findings without stopping every branch in flight. ESLint enforces one half of
 * that on its own: grow a count and it reports every violation in the file
 * rather than the new one alone.
 *
 * It does not enforce the other half. Nothing stops somebody running
 * `--suppress-all` a second time to bless a fresh violation, and the ledger
 * grows silently — the same failure the suppressions were meant to prevent,
 * one level up. And nothing makes touching a 4,000-line file cost anything, so
 * the debt would sit there being edited around forever.
 *
 * Two rules, both against the Git merge base:
 *
 *   1. The ledger never grows. No file gains an entry, no count rises, and no
 *      package gains a ledger it did not have.
 *   2. Touching costs. A changed file that carries an entry has to come out
 *      strictly better — fewer lines, or fewer suppressed violations.
 *
 * Rule 2 is gameable by deleting a blank line, and that is accepted. The point
 * is to put the debt in front of whoever opened the file, not to be impossible
 * to route around; somebody determined to avoid the work can always avoid it,
 * and this at least makes them decide to.
 *
 * Comparing against the merge base rather than the tip means a branch is judged
 * on what it changed. Comparing the working tree rather than HEAD means the
 * failure arrives while the developer is still standing in front of the fix.
 *
 * Usage: `pnpm check:debt` — exit 0 = the debt shrank or held, exit 1 = it grew.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** What the base branch is called. Overridable for a fork or a release line.
 * Both spellings are tried, because `actions/checkout` leaves a pull request on
 * a detached HEAD with no local branch: `main` resolves on a contributor's
 * machine and only `origin/main` resolves in CI. Trying one spelling meant the
 * ratchet silently skipped every CI run and caught offences on laptops alone. */
const BASES = process.env.DEBT_BASE_REF ? [process.env.DEBT_BASE_REF] : ['main', 'origin/main'];

const LEDGER = 'eslint-suppressions.json';

/**
 * ESLint's on-disk shape: file → rule → { count }, with paths relative to the
 * ledger's own directory.
 *
 * Both levels are optional because this is parsed from a file rather than
 * built here, and a plain `Record` would tell the compiler every lookup
 * succeeds — which makes the guards below read as dead code.
 */
type RuleCounts = Record<string, { count: number } | undefined>;
type Ledger = Record<string, RuleCounts | undefined>;

interface Offence {
  path: string;
  problem: string;
  fix: string;
}

/** One ledger, at both revisions, plus what it needs to judge the diff. */
interface LedgerComparison {
  ledgerPath: string;
  base: Ledger;
  current: Ledger;
  changed: Set<string>;
  baseRef: string;
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // A missing path is an expected answer here, not a failure worth printing.
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** File contents at a revision, or undefined when the path did not exist there. */
function show(ref: string, path: string): string | undefined {
  try {
    return git(['show', `${ref}:${path}`]);
  } catch {
    return undefined;
  }
}

function parseLedger(text: string | undefined): Ledger {
  if (text === undefined) return {};
  return JSON.parse(text) as Ledger;
}

function readLedger(path: string): Ledger {
  const full = join(ROOT, path);
  return existsSync(full) ? parseLedger(readFileSync(full, 'utf8')) : {};
}

function total(rules: RuleCounts | undefined): number {
  if (!rules) return 0;
  return Object.values(rules).reduce((sum, rule) => sum + (rule?.count ?? 0), 0);
}

function lineCount(text: string): number {
  return text.split('\n').length;
}

/**
 * Rule 1, over every ledger that exists at either revision. A package that
 * gained a ledger is covered because its base copy parses as empty, so every
 * entry in it reads as new.
 */
function findGrowth(ledgerPath: string, base: Ledger, current: Ledger): Offence[] {
  const offences: Offence[] = [];
  const dir = dirname(ledgerPath) === '.' ? '' : `${dirname(ledgerPath)}/`;
  for (const [file, rules] of Object.entries(current)) {
    for (const [rule, entry] of Object.entries(rules ?? {})) {
      const count = entry?.count ?? 0;
      const before = base[file]?.[rule]?.count ?? 0;
      if (count <= before) continue;
      offences.push({
        path: `${dir}${file}`,
        problem:
          before === 0
            ? `newly suppresses ${rule}`
            : `suppresses ${rule} ${count} times, up from ${before}`,
        fix: 'fix the finding instead of recording it — the ledger is not an inbox',
      });
    }
  }
  return offences;
}

/**
 * Whether every changed line in a file is part of an import statement.
 *
 * A file whose only edit is the shape of an import was moved against, not
 * edited: someone renamed a module, or changed the form an import has to take,
 * and this file followed. Charging debt for that turns a mechanical migration
 * into a demand to refactor every file it passes through, which is how such a
 * migration stalls. `every` is the point — one changed line that is not an
 * import closes the exemption.
 *
 * This mirrors `lvbt check debt` in @lvbt/cli, which owns the same ratchet for
 * the organization.
 */
function onlyImportsChanged(baseRef: string, path: string): boolean {
  const changed = git(['diff', baseRef, '--', path])
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
  return (
    changed.length > 0 &&
    changed.every((line) => /^[+-]\s*(import\b|\}?\s*from\s+['"]|[\w$]+,?\s*$)/.test(line))
  );
}

/** Rule 2, over the files this branch touched. */
function findUnpaidEdits({
  ledgerPath,
  base,
  current,
  changed,
  baseRef,
}: LedgerComparison): Offence[] {
  const offences: Offence[] = [];
  const dir = dirname(ledgerPath) === '.' ? '' : `${dirname(ledgerPath)}/`;
  for (const [file, rules] of Object.entries(base)) {
    const path = `${dir}${file}`;
    if (!changed.has(path)) continue;
    // Deleting the file is the largest possible improvement.
    if (!existsSync(join(ROOT, path))) continue;

    const before = total(rules);
    const after = total(current[file]);
    if (after < before) continue;

    const textBefore = show(baseRef, path);
    const linesAfter = lineCount(readFileSync(join(ROOT, path), 'utf8'));
    if (textBefore !== undefined && linesAfter < lineCount(textBefore)) continue;

    if (onlyImportsChanged(baseRef, path)) continue;

    offences.push({
      path,
      problem: `carries ${before} suppressed findings and was changed without shrinking`,
      fix: 'remove a finding and run `eslint --prune-suppressions`, or make the file shorter',
    });
  }
  return offences;
}

function main(): void {
  let base: string | undefined;
  for (const candidate of BASES) {
    try {
      base = git(['merge-base', candidate, 'HEAD']).trim();
      break;
    } catch {
      continue;
    }
  }
  if (base === undefined) {
    // A shallow clone or a repository with no base branch yet. Skipping loudly
    // beats failing a build for a reason nobody can act on.
    console.log(`debt: no merge base with ${BASES.join(' or ')}, skipping the ratchet check.`);
    return;
  }

  const changed = new Set(
    git(['diff', '--name-only', base])
      .split('\n')
      .filter((line) => line.length > 0),
  );

  // Ledgers at either revision: one that was deleted still has to be accounted
  // for, and one that was added is pure growth.
  const ledgers = new Set(
    [
      ...git(['ls-files', `*${LEDGER}`]).split('\n'),
      ...git(['ls-tree', '-r', '--name-only', base]).split('\n'),
    ].filter((path) => path === LEDGER || path.endsWith(`/${LEDGER}`)),
  );

  const offences: Offence[] = [];
  const introduced: string[] = [];
  for (const ledgerPath of ledgers) {
    const baseText = show(base, ledgerPath);
    const before = parseLedger(baseText);
    const now = readLedger(ledgerPath);

    if (baseText === undefined) {
      // A ledger with nothing to compare against. The branch that turns a rule
      // on is the one branch where every entry is new by construction, and
      // there is no earlier number for it to be worse than. The ratchet engages
      // for everyone else once this lands on the base branch.
      introduced.push(ledgerPath);
      continue;
    }
    if (!existsSync(join(ROOT, ledgerPath))) {
      // Which closes the obvious way around the paragraph above: delete the
      // ledger, regenerate it, and every count resets. Removing one is a
      // reviewable line in the diff, and now a failing check as well.
      offences.push({
        path: ledgerPath,
        problem: 'existed on the base branch and is gone',
        fix: 'restore it — if the package is genuinely clean now, commit an empty ledger instead',
      });
      continue;
    }

    offences.push(...findGrowth(ledgerPath, before, now));
    offences.push(
      ...findUnpaidEdits({ ledgerPath, base: before, current: now, changed, baseRef: base }),
    );
  }

  if (offences.length > 0) {
    console.error('\ndebt: suppressed lint findings may only go down.\n');
    for (const offence of offences) {
      console.error(`  ${offence.path} ${offence.problem}`);
      console.error(`    fix: ${offence.fix}`);
    }
    console.error(
      '\n  A suppression records debt that already existed. Adding one hides a' +
        '\n  finding nobody has seen yet, and editing a file without paying any' +
        '\n  of it down is how a file stays 4,000 lines for a decade.' +
        '\n  See docs/development/explanation/enforcement-model.md#lint-debt\n',
    );
    process.exit(1);
  }

  for (const path of introduced) {
    console.log(`debt: ${path} is new on this branch, so there is no baseline to ratchet against.`);
  }
  console.log(`debt: ${ledgers.size} ledgers, none grew.`);
}

main();
