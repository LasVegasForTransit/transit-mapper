import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCommand } from '../lib/shell.js';
import { printToolTable, promptConfirm, type ToolRow } from '../lib/ui.js';
import { BRANCH_RULESET, SECURITY_SETTINGS, REQUIRES_ORGANIZATION } from '../standards.js';
import type { PhaseResult } from './auth.js';

/**
 * Applies the organization's governance standard to the GitHub repository.
 *
 * The settings that decide whether a broken change can reach production do
 * not live in the repository tree. They live in GitHub, and until this phase
 * existed the only record of them was prose telling a person which checkboxes
 * to tick. A standard nobody applies is a standard nobody has: this
 * repository had zero rulesets, so its default branch accepted a direct push
 * from anyone with write access.
 *
 * The desired state is in `standards.ts`. This file reads it, compares it
 * with what GitHub reports, and either lists the differences or converges on
 * them.
 */

interface GhJson {
  ok: boolean;
  data: unknown;
}

/** Runs a `gh api` call and parses the response. */
function ghApi(args: string, input?: unknown): GhJson {
  let file: string | undefined;
  let command = `gh api ${args}`;
  if (input !== undefined) {
    file = path.join(tmpdir(), `repo-config.${process.pid}.${Math.abs(Date.now() % 100000)}.json`);
    writeFileSync(file, JSON.stringify(input), 'utf8');
    command += ` --input ${file}`;
  }
  const result = runCommand(command);
  if (file) unlinkSync(file);
  if (!result.ok) return { ok: false, data: result.stderr };
  try {
    return { ok: true, data: JSON.parse(result.stdout) as unknown };
  } catch {
    return { ok: true, data: result.stdout };
  }
}

interface RulesetSummary {
  id: number;
  name: string;
}

function findRuleset(name: string): RulesetSummary | null {
  const listed = ghApi('repos/:owner/:repo/rulesets');
  if (!listed.ok || !Array.isArray(listed.data)) return null;
  return (listed.data as RulesetSummary[]).find((r) => r.name === name) ?? null;
}

/** True when the repository belongs to an organization rather than a user. */
function isOrganizationOwned(): boolean {
  const repo = ghApi('repos/:owner/:repo --jq .owner.type');
  return typeof repo.data === 'string' && repo.data.trim() === 'Organization';
}

interface SecurityState {
  [key: string]: { status?: string } | undefined;
}

function securityDrift(): string[] {
  const repo = ghApi('repos/:owner/:repo --jq .security_and_analysis');
  if (!repo.ok || typeof repo.data !== 'object' || repo.data === null) return [];
  const current = repo.data as SecurityState;
  return Object.entries(SECURITY_SETTINGS)
    .filter(([key, want]) => current[key]?.status !== want)
    .map(([key]) => key);
}

export async function runRepoConfigPhase(options: { doctor: boolean }): Promise<PhaseResult> {
  const rows: ToolRow[] = [];
  const pending: string[] = [];

  // Ruleset on the default branch.
  const existing = findRuleset(BRANCH_RULESET.name);
  if (existing) {
    rows.push({
      label: 'Branch ruleset',
      status: 'ready',
      detail: `"${BRANCH_RULESET.name}" present`,
    });
  } else {
    rows.push({
      label: 'Branch ruleset',
      status: 'failed',
      detail: `"${BRANCH_RULESET.name}" missing — the default branch accepts direct pushes`,
    });
    pending.push('ruleset');
  }

  // Secret scanning and push protection.
  const drift = securityDrift();
  if (drift.length === 0) {
    rows.push({
      label: 'Secret scanning',
      status: 'ready',
      detail: 'scanning and push protection on',
    });
  } else {
    rows.push({
      label: 'Secret scanning',
      status: 'failed',
      detail: `disabled: ${drift.join(', ')}`,
    });
    pending.push('security');
  }

  // Settings this account cannot have, reported rather than attempted.
  if (!isOrganizationOwned()) {
    for (const blocked of REQUIRES_ORGANIZATION) {
      rows.push({
        label: blocked.setting,
        status: 'skipped',
        detail: `${blocked.reason} — unblocked by ${blocked.unblockedBy}`,
      });
    }
  }

  if (pending.length === 0) {
    printToolTable('Repository governance', rows);
    return { success: true };
  }

  if (options.doctor) {
    printToolTable('Repository governance', rows);
    return { success: false };
  }

  printToolTable('Repository governance', rows);

  const confirmed = await promptConfirm(
    'Apply the organization governance standard to this repository?',
    true,
  );
  if (!confirmed) return { success: false };

  const applied: ToolRow[] = [];

  if (pending.includes('ruleset')) {
    const created = ghApi('repos/:owner/:repo/rulesets -X POST', BRANCH_RULESET);
    applied.push(
      created.ok
        ? {
            label: 'Branch ruleset',
            status: 'ready',
            detail: 'created — direct pushes to the default branch now rejected',
          }
        : { label: 'Branch ruleset', status: 'failed', detail: String(created.data).slice(0, 160) },
    );
  }

  if (pending.includes('security')) {
    const patched = ghApi('repos/:owner/:repo -X PATCH', {
      security_and_analysis: Object.fromEntries(
        Object.entries(SECURITY_SETTINGS).map(([key, status]) => [key, { status }]),
      ),
    });
    applied.push(
      patched.ok
        ? { label: 'Secret scanning', status: 'ready', detail: 'enabled' }
        : {
            label: 'Secret scanning',
            status: 'failed',
            detail: String(patched.data).slice(0, 160),
          },
    );
  }

  printToolTable('Applied', applied);
  return { success: applied.every((r) => r.status === 'ready') };
}
