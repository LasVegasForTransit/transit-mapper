import { z } from 'zod';
import { doctorCheck } from './doctor-check.js';
import { matchesPinnedRules, matchesPinnedRuleset } from './ruleset.js';

const repositorySettings = z.object({
  allow_merge_commit: z.literal(false),
  allow_squash_merge: z.literal(false),
  allow_rebase_merge: z.literal(true),
  security_and_analysis: z.object({
    secret_scanning: z.object({ status: z.literal('enabled') }),
    secret_scanning_push_protection: z.object({ status: z.literal('enabled') }),
  }),
});
type Read = (endpoint: string) => Promise<unknown>;
export async function githubGovernanceDoctor(
  target: { repository: string; ruleset: unknown },
  read: Read,
) {
  const base = `repos/${target.repository}`;
  const check = (id: string, requirement: string, inspect: () => Promise<boolean>) =>
    doctorCheck(id, requirement, inspect);
  return await Promise.all([
    check(
      'merge-methods',
      'Settings → General: enable rebase; disable merge and squash.',
      async () =>
        repositorySettings
          .pick({ allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true })
          .safeParse(await read(base)).success,
    ),
    check(
      'secret-scanning',
      'Settings → Code security: enable secret scanning and push protection.',
      async () =>
        repositorySettings.pick({ security_and_analysis: true }).safeParse(await read(base))
          .success,
    ),
    check(
      'actions-policy',
      'Settings → Actions: enable Actions and require full commit SHA pins.',
      async () =>
        z
          .object({ enabled: z.literal(true), sha_pinning_required: z.literal(true) })
          .safeParse(await read(`${base}/actions/permissions`)).success,
    ),
    check(
      'workflow-permissions',
      'Settings → Actions: default token read-only; allow contribution automation.',
      async () =>
        z
          .object({
            default_workflow_permissions: z.literal('read'),
            can_approve_pull_request_reviews: z.literal(true),
          })
          .safeParse(await read(`${base}/actions/permissions/workflow`)).success,
    ),
    check(
      'ruleset',
      'Settings → Rules: apply the reviewed organization ruleset; preserve additional merge-queue protections.',
      async () => {
        return await rulesMatch(target.ruleset, read, base);
      },
    ),
    check(
      'vulnerability-alerts',
      'Settings → Code security: enable Dependabot alerts.',
      async () => {
        await read(`${base}/vulnerability-alerts`);
        return true;
      },
    ),
    check(
      'security-updates',
      'Settings → Code security: enable and unpause Dependabot security updates.',
      async () => {
        const updates = z
          .object({ enabled: z.boolean(), paused: z.boolean() })
          .parse(await read(`${base}/automated-security-fixes`));
        return updates.enabled && !updates.paused;
      },
    ),
  ]);
}

async function rulesMatch(standard: unknown, read: Read, base: string): Promise<boolean> {
  const expected = z
    .object({ name: z.string(), rules: z.array(z.unknown()) })
    .loose()
    .parse(standard);
  const summaries = z
    .array(z.object({ id: z.number(), name: z.string() }))
    .parse(await read(`${base}/rulesets`));
  const owned = summaries.filter((rule) => rule.name === expected.name);
  if (owned.length !== 1) return false;
  const actual = z
    .object({ rules: z.array(z.unknown()) })
    .loose()
    .parse(await read(`${base}/rulesets/${owned[0]?.id}`));
  const { rules: _expectedRules, ...fields } = expected;
  const { rules: _actualRules, ...observed } = actual;
  return matchesPinnedRuleset(observed, fields) && matchesPinnedRules(actual.rules, expected);
}
