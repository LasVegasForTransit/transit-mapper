import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Suppressed lint debt only ever shrinks. ESLint's `--suppress-all` freezes
 * existing violations in eslint-suppressions.json so a rule can be turned on
 * without stopping every branch in flight; this check adds the other half:
 * no ledger grows against the base branch, and a changed file that carries
 * suppressions comes out strictly better (fewer findings or fewer lines).
 *
 * One growth is allowed: a rule the base ledger never recorded anywhere is a
 * rule the repository is adopting, and `eslint --suppress-all` records its
 * existing findings once. Every rule already in the ledger stays a ratchet.
 */
const LEDGER = 'eslint-suppressions.json';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function show(cwd, ref, path) {
  try {
    return git(cwd, ['show', `${ref}:${path}`]);
  } catch {
    return undefined;
  }
}

const parseLedger = (text) => (text === undefined ? {} : JSON.parse(text));

/**
 * A file whose only changed lines are import specifiers was renamed or moved
 * against, not edited: that change neither adds nor pays down debt, so the
 * ratchet leaves it alone. Every other change to a suppressed file has to
 * shrink it.
 */
function onlyImportsChanged(cwd, baseRef, path) {
  const diff = git(cwd, ['diff', baseRef, '--', path]);
  const changed = diff
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
  return (
    changed.length > 0 &&
    changed.every((line) => /^[+-]\s*(import\b|\}?\s*from\s+['"]|[\w$]+,?\s*$)/.test(line))
  );
}
const total = (rules) =>
  Object.values(rules ?? {}).reduce((sum, rule) => sum + (rule?.count ?? 0), 0);
const lineCount = (text) => text.split('\n').length;

function growth(ledgerPath, base, current) {
  const prefix = dirname(ledgerPath) === '.' ? '' : `${dirname(ledgerPath)}/`;
  const knownRules = new Set(Object.values(base).flatMap((rules) => Object.keys(rules ?? {})));
  const lines = [];
  for (const [file, rules] of Object.entries(current)) {
    for (const [rule, entry] of Object.entries(rules ?? {})) {
      const count = entry?.count ?? 0;
      const before = base[file]?.[rule]?.count ?? 0;
      if (count > before && knownRules.has(rule)) {
        lines.push(
          `${prefix}${file} ${before === 0 ? `newly suppresses ${rule}` : `suppresses ${rule} ${count} times, up from ${before}`}`,
        );
      }
    }
  }
  return lines;
}

function unpaidEdits({ cwd, ledgerPath, base, current, changed, baseRef }) {
  const prefix = dirname(ledgerPath) === '.' ? '' : `${dirname(ledgerPath)}/`;
  const lines = [];
  for (const [file, rules] of Object.entries(base)) {
    const path = `${prefix}${file}`;
    if (!changed.has(path) || !existsSync(join(cwd, path))) continue;
    if (total(current[file]) < total(rules)) continue;
    const before = show(cwd, baseRef, path);
    const after = lineCount(readFileSync(join(cwd, path), 'utf8'));
    if (before !== undefined && after < lineCount(before)) continue;
    if (onlyImportsChanged(cwd, baseRef, path)) continue;
    lines.push(
      `${path} carries ${total(rules)} suppressed findings and was changed without shrinking`,
    );
  }
  return lines;
}

function currentLedger({
  cwd,
  ledgerPath,
  baseText,
  currentLedgers,
  newLedgers,
  missingLedgers,
  renames,
}) {
  if (existsSync(join(cwd, ledgerPath))) return ledgerPath;
  const detectedRename = renames.get(ledgerPath);
  if (detectedRename !== undefined) return detectedRename;
  const identicalMoves = currentLedgers.filter(
    (path) =>
      path !== ledgerPath &&
      existsSync(join(cwd, path)) &&
      readFileSync(join(cwd, path), 'utf8') === baseText,
  );
  if (identicalMoves.length === 1) return identicalMoves[0];
  if (missingLedgers.length === 1 && newLedgers.length === 1) return newLedgers[0];
  return undefined;
}

export function checkDebt({ cwd, baseBranch = process.env.DEBT_BASE_REF ?? 'main' }) {
  let base;
  try {
    base = git(cwd, ['merge-base', baseBranch, 'HEAD']).trim();
  } catch {
    return {
      name: 'debt',
      ok: true,
      lines: [`no merge base with "${baseBranch}"; skipped (CI checks out full history)`],
    };
  }

  const changed = new Set(git(cwd, ['diff', '--name-only', base]).split('\n').filter(Boolean));
  const renames = new Map(
    git(cwd, ['diff', '--name-status', '--find-renames', base])
      .split('\n')
      .map((line) => line.split('\t'))
      .filter(([status, from, to]) => status?.startsWith('R') && from && to)
      .map(([, from, to]) => [from, to]),
  );
  const currentLedgers = git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard'])
    .split('\n')
    .filter((path) => path === LEDGER || path.endsWith(`/${LEDGER}`));
  const baseLedgers = git(cwd, ['ls-tree', '-r', '--name-only', base])
    .split('\n')
    .filter((path) => path === LEDGER || path.endsWith(`/${LEDGER}`));
  const newLedgers = currentLedgers.filter((path) => !baseLedgers.includes(path));
  const missingLedgers = baseLedgers.filter((path) => !existsSync(join(cwd, path)));
  const ledgers = new Set(
    [...currentLedgers, ...baseLedgers].filter(
      (path) => path === LEDGER || path.endsWith(`/${LEDGER}`),
    ),
  );

  const lines = [];
  for (const ledgerPath of ledgers) {
    const baseText = show(cwd, base, ledgerPath);
    if (baseText === undefined) continue; // new on this branch: no baseline yet
    const currentLedgerPath = currentLedger({
      cwd,
      ledgerPath,
      baseText,
      currentLedgers,
      newLedgers,
      missingLedgers,
      renames,
    });
    if (currentLedgerPath === undefined || !existsSync(join(cwd, currentLedgerPath))) {
      lines.push(
        `${ledgerPath} existed on the base branch and is gone; restore it or commit an empty ledger`,
      );
      continue;
    }
    const before = parseLedger(baseText);
    const current = parseLedger(readFileSync(join(cwd, currentLedgerPath), 'utf8'));
    lines.push(...growth(currentLedgerPath, before, current));
    if (currentLedgerPath === ledgerPath)
      lines.push(
        ...unpaidEdits({ cwd, ledgerPath, base: before, current, changed, baseRef: base }),
      );
  }
  return {
    name: 'debt',
    ok: lines.length === 0,
    lines,
    fix: 'fix the finding instead of recording it, or make the touched file shorter; a suppression records debt that already existed',
  };
}
