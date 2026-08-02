/**
 * The governance standard every repository in the organization is held to.
 *
 * This file is data. `phases/repo-config.ts` reads it, compares it against
 * what GitHub currently reports, and either lists the differences or applies
 * them. Changing the standard means editing this file, not the phase.
 */

/** Rules on the default branch, as a GitHub repository ruleset. */
export const BRANCH_RULESET = {
  name: 'org-standard',
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
  rules: [
    // The branch cannot be deleted or force-pushed. These two make history
    // on the default branch durable.
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    { type: 'required_linear_history' },
    {
      type: 'pull_request',
      parameters: {
        // Zero, not one, and this is the difference between a guardrail and
        // a locked door. GitHub does not let anyone approve their own pull
        // request, and a repository whose only collaborator is its
        // maintainer has nobody else to ask — so requiring one approval
        // means nothing can ever reach the default branch again, including
        // the change that would relax the rule.
        //
        // What survives at zero is the part that does the work: a change
        // still has to arrive as a pull request, and the required status
        // check below still has to pass before it merges. The review count
        // goes to 1 the day a second maintainer exists, which is the same
        // day it starts being satisfiable.
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
        allowed_merge_methods: ['squash', 'rebase'],
      },
    },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        // The job name in .github/workflows/ci.yml. A ruleset naming a check
        // that never reports blocks every pull request permanently, so this
        // string and that job name are one fact in two places.
        required_status_checks: [{ context: 'Validate' }],
      },
    },
  ],
} as const;

/** Settings under the repository's `security_and_analysis` object. */
export const SECURITY_SETTINGS = {
  secret_scanning: 'enabled',
  secret_scanning_push_protection: 'enabled',
} as const;

/** Repository-level Actions policy, separate from workflow token permissions. */
export const ACTIONS_POLICY_SETTINGS = {
  enabled: true,
  sha_pinning_required: true,
} as const;

/**
 * Permissions granted to the token GitHub Actions provides to a workflow.
 *
 * A workflow token defaults to write access across the repository unless
 * told otherwise, which means any compromised action in any workflow can
 * push commits. Keep that default read-only and grant writes to the release
 * job explicitly. GitHub combines permission to create pull requests with
 * permission to approve them in one repository setting; Release Please needs
 * that setting enabled to maintain its generated release pull request.
 */
export const ACTIONS_SETTINGS = {
  default_workflow_permissions: 'read',
  can_approve_pull_request_reviews: true,
} as const;

/**
 * Mutating governance calls in dependency order.
 *
 * Dependabot security updates require the dependency graph and vulnerability
 * alerts, so the alerts endpoint must succeed first.
 */
export const GOVERNANCE_APPLY_ORDER = [
  'ruleset',
  'security',
  'vulnerability-alerts',
  'dependabot-security-updates',
  'actions-policy',
  'actions-workflow',
] as const;

/**
 * Settings that cannot be configured on a repository owned by a personal
 * account, and are reported as blocked rather than attempted.
 *
 * Verified against the live API rather than assumed: creating a ruleset
 * containing a `merge_queue` rule on a personal repository is rejected with
 * a validation error regardless of the parameters supplied.
 */
export const REQUIRES_ORGANIZATION = [
  {
    setting: 'merge queue',
    reason: 'GitHub restricts merge queue to repositories owned by an organization',
    unblockedBy: 'transferring the repository to the organization',
  },
] as const;
