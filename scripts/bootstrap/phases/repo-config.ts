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
  ACTIONS_POLICY_SETTINGS,
  ACTIONS_SETTINGS,
  GOVERNANCE_APPLY_ORDER,
  REQUIRED_ENVIRONMENTS,
  REQUIRES_ORGANIZATION,
} from '../standards.js';
import { actionsPolicyBody, booleanEndpointState, settingDrift } from '../governance.js';
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
  key: (typeof GOVERNANCE_APPLY_ORDER)[number];
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

type SecurityState = Record<string, { status?: string } | undefined>;

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
  const off = settingDrift(current, SECURITY_SETTINGS, (value) => value?.status);

  return off.length === 0
    ? { label: 'Secret scanning', status: 'ready', detail: 'scanning and push protection on' }
    : {
        key: 'security',
        row: { label: 'Secret scanning', status: 'failed', detail: `off: ${off.join(', ')}` },
      };
}

function vulnerabilityAlertsState(): Drift | ToolRow {
  const result = ghApi('repos/:owner/:repo/vulnerability-alerts');
  const state = booleanEndpointState(result);
  if (state === 'enabled') {
    return { label: 'Vulnerability alerts', status: 'ready', detail: 'enabled' };
  }
  if (state === 'disabled') {
    return {
      key: 'vulnerability-alerts',
      row: { label: 'Vulnerability alerts', status: 'failed', detail: 'disabled' },
    };
  }
  return {
    label: 'Vulnerability alerts',
    status: 'failed',
    detail: `could not read current setting — ${result.error.slice(0, 120)}`,
  };
}

function dependabotSecurityUpdatesState(): Drift | ToolRow {
  // Unlike vulnerability alerts, this endpoint returns 200 for both states;
  // the response body's `enabled` field is the setting's source of truth.
  const result = ghApi('repos/:owner/:repo/automated-security-fixes');
  if (!result.ok || typeof result.data !== 'object' || result.data === null) {
    return {
      label: 'Dependabot updates',
      status: 'failed',
      detail: `could not read current setting — ${result.error.slice(0, 120)}`,
    };
  }

  const enabled = (result.data as { enabled?: unknown }).enabled;
  if (enabled === true) {
    return { label: 'Dependabot updates', status: 'ready', detail: 'enabled' };
  }
  if (enabled === false) {
    return {
      key: 'dependabot-security-updates',
      row: { label: 'Dependabot updates', status: 'failed', detail: 'disabled' },
    };
  }

  return {
    label: 'Dependabot updates',
    status: 'failed',
    detail: 'could not read current setting — response omitted enabled',
  };
}

function actionsPolicyState(): Drift | ToolRow {
  const current = ghApi('repos/:owner/:repo/actions/permissions');
  if (!current.ok || typeof current.data !== 'object' || current.data === null) {
    return { label: 'Actions policy', status: 'failed', detail: 'could not read current settings' };
  }
  const wrong = settingDrift(current.data as Record<string, unknown>, ACTIONS_POLICY_SETTINGS);

  return wrong.length === 0
    ? {
        label: 'Actions policy',
        status: 'ready',
        detail: 'enabled; full commit-SHA pinning required',
      }
    : {
        key: 'actions-policy',
        row: {
          label: 'Actions policy',
          status: 'failed',
          detail: `${wrong.join(', ')} not at the standard`,
        },
      };
}

function actionsWorkflowState(): Drift | ToolRow {
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
        detail: `${ACTIONS_SETTINGS.default_workflow_permissions}-only by default`,
      }
    : {
        key: 'actions-workflow',
        row: {
          label: 'Actions token',
          status: 'failed',
          detail: `${wrong.map(([k]) => k).join(', ')} not at the standard`,
        },
      };
}

function environmentsState(): Drift | ToolRow {
  // One call for all of them: the per-environment endpoint would be a `gh`
  // subprocess and a round trip each, and this list is the standard's to grow.
  const current = ghApi('repos/:owner/:repo/environments');
  const environments =
    current.ok && typeof current.data === 'object' && current.data !== null
      ? ((current.data as { environments?: { name?: string }[] }).environments ?? [])
      : [];
  const present = new Set(environments.map((environment) => environment.name));
  const missing = REQUIRED_ENVIRONMENTS.filter((name) => !present.has(name));

  if (!current.ok) {
    return { label: 'Environments', status: 'failed', detail: 'could not read current settings' };
  }

  return missing.length === 0
    ? { label: 'Environments', status: 'ready', detail: REQUIRED_ENVIRONMENTS.join(', ') }
    : {
        key: 'environments',
        row: {
          label: 'Environments',
          status: 'failed',
          detail: `${missing.join(', ')} absent — deployment credentials have nowhere to live`,
        },
      };
}

/**
 * PUT is idempotent here, so this converges whether the environment is absent
 * or merely absent from the drift report. No body: protection rules are
 * deliberately not part of the standard, because a required reviewer on
 * `preview` would stall every push to every pull request.
 */
function applyEnvironments(): ToolRow[] {
  return REQUIRED_ENVIRONMENTS.map((name) => {
    const result = ghApi(`--method PUT repos/:owner/:repo/environments/${name}`);
    return result.ok
      ? { label: `Environment ${name}`, status: 'ready' as const, detail: 'present' }
      : {
          label: `Environment ${name}`,
          status: 'failed' as const,
          detail: result.error.slice(0, 160),
        };
  });
}

function isDrift(value: Drift | ToolRow): value is Drift {
  return 'key' in value;
}

/**
 * Converges each pending setting, in dependency order, and reports what
 * each call did. Separated from the phase so the decision to apply and the
 * applying itself are readable apart.
 */
function applyGovernance(pending: readonly (typeof GOVERNANCE_APPLY_ORDER)[number][]): ToolRow[] {
  const applied: ToolRow[] = [];

  for (const key of GOVERNANCE_APPLY_ORDER) {
    if (!pending.includes(key)) continue;

    if (key === 'environments') {
      applied.push(...applyEnvironments());
      continue;
    }

    if (key === 'ruleset') {
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
      continue;
    }

    if (key === 'security') {
      // Both keys in one request. Sent separately, there is a window where
      // push protection is requested against a repository whose scanning is
      // still off, which GitHub rejects.
      const result = ghApi('--method PATCH repos/:owner/:repo', {
        security_and_analysis: Object.fromEntries(
          Object.entries(SECURITY_SETTINGS).map(([setting, status]) => [setting, { status }]),
        ),
      });
      applied.push(
        result.ok
          ? { label: 'Secret scanning', status: 'ready', detail: 'enabled' }
          : { label: 'Secret scanning', status: 'failed', detail: result.error.slice(0, 160) },
      );
      continue;
    }

    if (key === 'vulnerability-alerts' || key === 'dependabot-security-updates') {
      const vulnerabilityAlerts = key === 'vulnerability-alerts';
      const label = vulnerabilityAlerts ? 'Vulnerability alerts' : 'Dependabot updates';
      const endpoint = vulnerabilityAlerts ? 'vulnerability-alerts' : 'automated-security-fixes';
      const result = ghApi(`--method PUT repos/:owner/:repo/${endpoint}`);
      applied.push(
        result.ok
          ? { label, status: 'ready', detail: 'enabled' }
          : { label, status: 'failed', detail: result.error.slice(0, 160) },
      );
      continue;
    }

    if (key === 'actions-policy') {
      const current = ghApi('repos/:owner/:repo/actions/permissions');
      const result =
        current.ok && typeof current.data === 'object' && current.data !== null
          ? ghApi(
              '--method PUT repos/:owner/:repo/actions/permissions',
              actionsPolicyBody(current.data),
            )
          : current;
      applied.push(
        result.ok
          ? {
              label: 'Actions policy',
              status: 'ready',
              detail: 'full commit-SHA pinning required',
            }
          : { label: 'Actions policy', status: 'failed', detail: result.error.slice(0, 160) },
      );
      continue;
    }

    const result = ghApi(
      '--method PUT repos/:owner/:repo/actions/permissions/workflow',
      ACTIONS_SETTINGS,
    );
    if (!result.ok) {
      applied.push({
        label: 'Actions token',
        status: 'failed',
        detail: result.error.slice(0, 160),
      });
      continue;
    }

    // An organization policy can accept this repository-level PUT with 204
    // while leaving the effective value unchanged. Re-read it so bootstrap
    // never claims Release Please is ready when GitHub will still refuse its
    // pull request.
    const verified = actionsWorkflowState();
    applied.push(
      isDrift(verified)
        ? {
            label: 'Actions token',
            status: 'failed',
            detail: 'organization policy still blocks workflow-created pull requests',
          }
        : verified,
    );
  }

  return applied;
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

  const states = [
    environmentsState(),
    rulesetState(),
    securityState(),
    vulnerabilityAlertsState(),
    dependabotSecurityUpdatesState(),
    actionsPolicyState(),
    actionsWorkflowState(),
  ];
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

  if (pending.length === 0) {
    return { success: rows.every((row) => row.status !== 'failed') };
  }
  if (options.doctor) return { success: false };

  const confirmed = await promptConfirm(
    'Apply the organization governance standard to this repository?',
    true,
  );
  if (!confirmed) return { success: false };

  const applied = applyGovernance(pending);

  printToolTable('Applied', applied);
  return { success: applied.every((r) => r.status === 'ready') };
}
