import {
  ghApi,
  canAdminister,
  isOrganizationOwned,
  findRuleset,
  rulesetDrift,
} from '../lib/github.js';
import { printToolTable, promptConfirm, type ToolRow } from '../lib/ui.js';
import {
  BRANCH_RULESET,
  SECURITY_SETTINGS,
  ACTIONS_SETTINGS,
  REQUIRES_ORGANIZATION,
} from '../standards.js';
import type { PhaseResult } from './auth.js';

/**
 * Applies the organization's governance standard to the GitHub repository.
 *
 * The settings deciding whether a broken change can reach production do not
 * live in the repository tree. They live in GitHub, and before this phase
 * the only record of them was prose telling a person which controls to set.
 * This repository had no rulesets at all, so its default branch accepted a
 * direct push from anyone with write access.
 *
 * The desired state is in `standards.ts`. This file compares it against what
 * GitHub reports and either lists the differences or converges on them.
 */

interface Drift {
  key: 'ruleset' | 'security' | 'actions';
  row: ToolRow;
}

function rulesetState(): Drift | ToolRow {
  const existing = findRuleset(BRANCH_RULESET.name);
  if (!existing) {
    return {
      key: 'ruleset',
      row: {
        label: 'Branch ruleset',
        status: 'failed',
        detail: `"${BRANCH_RULESET.name}" absent — the default branch accepts direct pushes`,
      },
    };
  }

  // A ruleset with the right name is not a ruleset with the right rules.
  const { differences } = rulesetDrift(existing.id, BRANCH_RULESET);
  if (differences.length > 0) {
    return {
      key: 'ruleset',
      row: {
        label: 'Branch ruleset',
        status: 'failed',
        detail: `"${BRANCH_RULESET.name}" differs — ${differences.join('; ')}`,
      },
    };
  }

  return { label: 'Branch ruleset', status: 'ready', detail: `"${BRANCH_RULESET.name}" matches` };
}

interface SecurityState {
  [key: string]: { status?: string } | undefined;
}

function securityState(): Drift | ToolRow {
  const repo = ghApi('repos/:owner/:repo --jq .security_and_analysis');
  if (!repo.ok || typeof repo.data !== 'object' || repo.data === null) {
    return {
      label: 'Secret scanning',
      status: 'failed',
      detail: 'could not read current settings',
    };
  }
  const current = repo.data as SecurityState;
  const off = Object.entries(SECURITY_SETTINGS)
    .filter(([key, want]) => current[key]?.status !== want)
    .map(([key]) => key);

  return off.length === 0
    ? { label: 'Secret scanning', status: 'ready', detail: 'scanning and push protection on' }
    : {
        key: 'security',
        row: { label: 'Secret scanning', status: 'failed', detail: `off: ${off.join(', ')}` },
      };
}

function actionsState(): Drift | ToolRow {
  const current = ghApi('repos/:owner/:repo/actions/permissions/workflow');
  if (!current.ok || typeof current.data !== 'object' || current.data === null) {
    return { label: 'Actions token', status: 'failed', detail: 'could not read current settings' };
  }
  const actual = current.data as Record<string, unknown>;
  const wrong = Object.entries(ACTIONS_SETTINGS).filter(([key, want]) => actual[key] !== want);

  return wrong.length === 0
    ? {
        label: 'Actions token',
        status: 'ready',
        detail: `${String(ACTIONS_SETTINGS.default_workflow_permissions)}-only by default`,
      }
    : {
        key: 'actions',
        row: {
          label: 'Actions token',
          status: 'failed',
          detail: `${wrong.map(([k]) => k).join(', ')} not at the standard`,
        },
      };
}

function isDrift(value: Drift | ToolRow): value is Drift {
  return 'key' in value;
}

export async function runRepoConfigPhase(options: { doctor: boolean }): Promise<PhaseResult> {
  // Checked first: without admin rights every call below returns 404 rather
  // than 403, because GitHub hides settings the caller cannot administer.
  // The resulting errors read as "no such repository" and mislead.
  if (!canAdminister()) {
    printToolTable('Repository governance', [
      {
        label: 'Permission',
        status: 'failed',
        detail: 'the authenticated account cannot administer this repository',
      },
    ]);
    return { success: false };
  }

  const states = [rulesetState(), securityState(), actionsState()];
  const rows = states.map((s) => (isDrift(s) ? s.row : s));
  const pending = states.filter(isDrift).map((s) => s.key);

  if (!isOrganizationOwned()) {
    for (const blocked of REQUIRES_ORGANIZATION) {
      rows.push({
        label: blocked.setting,
        status: 'skipped',
        detail: `${blocked.reason} — unblocked by ${blocked.unblockedBy}`,
      });
    }
  }

  printToolTable('Repository governance', rows);

  if (pending.length === 0) return { success: true };
  if (options.doctor) return { success: false };

  const confirmed = await promptConfirm(
    'Apply the organization governance standard to this repository?',
    true,
  );
  if (!confirmed) return { success: false };

  const applied: ToolRow[] = [];

  if (pending.includes('ruleset')) {
    // The full body every time. A PUT is a partial update at the top level,
    // so omitting a key preserves whatever is there — which for `rules`
    // means stale rules survive an update that looks like it replaced them.
    const existing = findRuleset(BRANCH_RULESET.name);
    const result = existing
      ? ghApi(`--method PUT repos/:owner/:repo/rulesets/${existing.id}`, BRANCH_RULESET)
      : ghApi('--method POST repos/:owner/:repo/rulesets', BRANCH_RULESET);
    applied.push(
      result.ok
        ? {
            label: 'Branch ruleset',
            status: 'ready',
            detail: existing ? 'updated to the standard' : 'created',
          }
        : { label: 'Branch ruleset', status: 'failed', detail: result.error.slice(0, 160) },
    );
  }

  if (pending.includes('security')) {
    // Both keys in one request. Sent separately, there is a window where
    // push protection is requested against a repository whose scanning is
    // still off, which GitHub rejects.
    const result = ghApi('--method PATCH repos/:owner/:repo', {
      security_and_analysis: Object.fromEntries(
        Object.entries(SECURITY_SETTINGS).map(([key, status]) => [key, { status }]),
      ),
    });
    applied.push(
      result.ok
        ? { label: 'Secret scanning', status: 'ready', detail: 'enabled' }
        : { label: 'Secret scanning', status: 'failed', detail: result.error.slice(0, 160) },
    );
  }

  if (pending.includes('actions')) {
    const result = ghApi(
      '--method PUT repos/:owner/:repo/actions/permissions/workflow',
      ACTIONS_SETTINGS,
    );
    applied.push(
      result.ok
        ? { label: 'Actions token', status: 'ready', detail: 'restricted to the standard' }
        : { label: 'Actions token', status: 'failed', detail: result.error.slice(0, 160) },
    );
  }

  printToolTable('Applied', applied);
  return { success: applied.every((r) => r.status === 'ready') };
}
