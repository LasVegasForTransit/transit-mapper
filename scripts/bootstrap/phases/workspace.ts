import { readFileSync } from 'node:fs';
import { runCommand } from '../lib/shell.js';
import { printToolTable, type ToolRow } from '../lib/ui.js';
import type { PhaseResult } from './auth.js';

/** Reads the floor from package.json rather than restating it here, so the
 *  two cannot disagree about what this project requires. */
function requiredNodeMajor(): number | null {
  const engines = (
    JSON.parse(readFileSync('package.json', 'utf8')) as { engines?: { node?: string } }
  ).engines;
  const match = /(\d+)/.exec(engines?.node ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * Confirms the toolchain can build this repository before anything is
 * provisioned in someone's Cloudflare account.
 *
 * The order matters: finding out that the install is broken *after* creating
 * cloud resources leaves a half-built account behind. Everything here is
 * local and reversible.
 */
export async function runWorkspacePhase(options: { doctor: boolean }): Promise<PhaseResult> {
  const rows: ToolRow[] = [];
  let ok = true;

  const required = requiredNodeMajor();
  const actual = Number(process.versions.node.split('.')[0]);
  if (required !== null && actual < required) {
    rows.push({
      label: 'Node',
      status: 'failed',
      detail: `${process.versions.node} — package.json requires >=${required}`,
    });
    ok = false;
  } else {
    rows.push({ label: 'Node', status: 'ready', detail: process.versions.node });
  }

  const pnpm = runCommand('pnpm --version');
  rows.push(
    pnpm.ok
      ? { label: 'pnpm', status: 'ready', detail: pnpm.stdout.trim() }
      : {
          label: 'pnpm',
          status: 'failed',
          detail: 'not on PATH — see https://pnpm.io/installation',
        },
  );
  if (!pnpm.ok) ok = false;

  // In doctor mode nothing is installed or written; the point is to report
  // what is wrong, not to change anything while doing so.
  if (!options.doctor) {
    const install = runCommand('pnpm install --frozen-lockfile');
    rows.push(
      install.ok
        ? { label: 'Dependencies', status: 'ready', detail: 'installed from the lockfile' }
        : {
            label: 'Dependencies',
            status: 'failed',
            detail: 'pnpm install --frozen-lockfile failed — is the lockfile out of date?',
          },
    );
    if (!install.ok) ok = false;
  }

  const drift = runCommand('pnpm run check:env');
  rows.push(
    drift.ok
      ? { label: 'Installed tree', status: 'ready', detail: 'matches the lockfile' }
      : {
          label: 'Installed tree',
          status: 'failed',
          detail: 'disagrees with the lockfile — run `pnpm install --frozen-lockfile`',
        },
  );
  if (!drift.ok) ok = false;

  // The whole bar, not a subset. If this passes, the checkout is one anyone
  // can open a pull request from.
  const check = runCommand('pnpm check');
  rows.push(
    check.ok
      ? { label: 'pnpm check', status: 'ready', detail: 'the repository is in a valid state' }
      : {
          label: 'pnpm check',
          status: 'failed',
          detail: 'run `pnpm check` to see what, then `pnpm check --fix`',
        },
  );
  if (!check.ok) ok = false;

  printToolTable('Workspace', rows);
  return { success: ok };
}
