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
        required_approving_review_count: 1,
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
