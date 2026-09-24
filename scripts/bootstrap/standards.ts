/**
 * The governance standard every repository in the organization is held to.
 *
 * This file is data. `phases/repo-config.ts` reads it, compares it against
 * what GitHub currently reports, and either lists the differences or applies
 * them. Changing the standard means editing this file, not the phase.
 */

/**
 * Status checks a pull request must pass before it can merge.
 *
 * Only checks CI reports both on the pull request and on the merge queue's
 * merge group. The queue waits for every required check on the merge group
 * and drops the entry when one never reports, so a check that runs on pull
 * requests alone (the RTC audit, for one) would stop anything from merging.
 * scripts/tests/governance-standard.test.ts holds this list to the workflows.
 */
export const REQUIRED_STATUS_CHECKS = [{ context: 'Validate' }] as const;

/**
 * How the merge queue lands a pull request, copied from the live ruleset.
 *
 * REBASE, like the pull request rule below: every commit reaches `main` as it
 * was reviewed, and `main` never gains a merge commit or a squashed stand-in
 * for the commits somebody read.
 */
const MERGE_QUEUE = {
  type: 'merge_queue',
  parameters: {
    merge_method: 'REBASE',
    grouping_strategy: 'ALLGREEN',
    check_response_timeout_minutes: 60,
    max_entries_to_build: 5,
    max_entries_to_merge: 5,
    min_entries_to_merge: 1,
    min_entries_to_merge_wait_minutes: 5,
  },
} as const;

/** Rules on the default branch, as a GitHub repository ruleset. */
export const BRANCH_RULESET = {
  name: 'org-standard',
  target: 'branch',
  enforcement: 'active',
  bypass_actors: [],
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
        // Kept as the live ruleset has it. The update writes the whole rule,
        // so a parameter left out here would be reset on the next repair.
        require_extra_approval_for_unattributed_changes: true,
        // Rebase only. Squash would replace the reviewed commits with one
        // nobody reviewed, and a merge commit breaks the linear history the
        // rule above requires.
        allowed_merge_methods: ['rebase'],
      },
    },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        // The terminal RTC job in .github/workflows/performance.yml. A
        // ruleset naming a check that never reports blocks every pull request
        // permanently, so this string and that job name are one fact in two
        // places.
        required_status_checks: REQUIRED_STATUS_CHECKS,
      },
    },
    MERGE_QUEUE,
  ],
} as const;

/** The ruleset to hold a repository to, given who owns it. */
export type BranchRuleset = Omit<typeof BRANCH_RULESET, 'rules'> & {
  readonly rules: readonly (typeof BRANCH_RULESET)['rules'][number][];
};

/**
 * The standard ruleset for this repository's owner.
 *
 * A repository owned by a personal account cannot have a merge queue (see
 * REQUIRES_ORGANIZATION), so its ruleset leaves that one rule out rather than
 * failing to save at all.
 */
export function branchRulesetFor(organizationOwned: boolean): BranchRuleset {
  return organizationOwned
    ? BRANCH_RULESET
    : { ...BRANCH_RULESET, rules: BRANCH_RULESET.rules.filter((rule) => rule !== MERGE_QUEUE) };
}

/**
 * Merge buttons the repository offers, under Settings → General.
 *
 * The ruleset already refuses squash and merge commits on `main`; turning the
 * buttons off as well means nobody is offered a method that then fails, and a
 * ruleset that is ever relaxed does not quietly bring them back.
 */
export const REPOSITORY_MERGE_SETTINGS = {
  allow_merge_commit: false,
  allow_squash_merge: false,
  allow_rebase_merge: true,
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
 * GitHub Environments the deployment workflows scope credentials to.
 *
 * `production` gates the release deploy; `preview` gates the per-pull-request
 * Workers. Declared here rather than assumed by the phase that writes secrets,
 * because until this existed nothing created them: `ci-secrets` set a secret
 * on an environment it expected to already be there, and printed a hint to go
 * make one by hand after the failure.
 */
export const REQUIRED_ENVIRONMENTS = ['production', 'preview'] as const;

/**
 * Mutating governance calls in dependency order.
 *
 * Dependabot security updates require the dependency graph and vulnerability
 * alerts, so the alerts endpoint must succeed first. Environments come first
 * of all: the `ci-secrets` phase writes into them and runs after this one.
 */
export const GOVERNANCE_APPLY_ORDER = [
  'environments',
  'merge-methods',
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
