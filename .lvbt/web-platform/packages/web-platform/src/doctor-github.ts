import { z } from 'zod';
import { doctorCheck, type DoctorCheck } from './doctor-check.js';
import { matchesPinnedRules } from './ruleset.js';

interface GitHubTarget {
  repository: string;
  branch: string;
  environment: string;
  accountId: string;
  zoneId: string;
  ruleset: unknown;
  preview?: {
    environment: string;
    secret: string;
    enabledVariable: string;
  };
}

const variables = z.object({
  variables: z.array(z.object({ name: z.string(), value: z.string() })),
});
type Read = (endpoint: string) => Promise<unknown>;
type Check = (
  id: string,
  requirement: string,
  inspect: () => Promise<boolean>,
) => Promise<DoctorCheck>;

async function previewChecks(
  previewTarget: NonNullable<GitHubTarget['preview']>,
  base: string,
  read: Read,
  check: Check,
) {
  const preview = `${base}/environments/${encodeURIComponent(previewTarget.environment)}`;
  return Promise.all([
    check('preview', 'The pull-request preview environment exists.', async () => {
      const value = await read(preview);
      return typeof value === 'object' && value !== null;
    }),
    check(
      'preview-credentials',
      `The preview environment contains ${previewTarget.secret}.`,
      async () =>
        z
          .object({ secrets: z.array(z.object({ name: z.string() })) })
          .parse(await read(`${preview}/secrets`))
          .secrets.some((secret) => secret.name === previewTarget.secret),
    ),
    check(
      'preview-enabled',
      `The ${previewTarget.enabledVariable} repository variable enables previews.`,
      async () =>
        variables
          .parse(await read(`${base}/actions/variables`))
          .variables.some(
            (variable) =>
              variable.name === previewTarget.enabledVariable && variable.value === 'true',
          ),
    ),
  ]);
}

async function productionPolicy(
  read: (endpoint: string) => Promise<unknown>,
  environment: string,
  branch: string,
) {
  const policy = z
    .object({
      deployment_branch_policy: z
        .object({ custom_branch_policies: z.boolean(), protected_branches: z.boolean() })
        .nullable(),
    })
    .parse(await read(environment)).deployment_branch_policy;
  if (policy === null || !policy.custom_branch_policies || policy.protected_branches) return false;
  const branches = z
    .object({ branch_policies: z.array(z.object({ name: z.string(), type: z.string() })) })
    .parse(await read(`${environment}/deployment-branch-policies`)).branch_policies;
  return branches.length === 1 && branches[0]?.name === branch && branches[0].type === 'branch';
}

export async function githubDoctor(target: GitHubTarget, read: Read) {
  const base = `repos/${target.repository}`;
  const environment = `${base}/environments/${encodeURIComponent(target.environment)}`;
  const check = (id: string, requirement: string, inspect: () => Promise<boolean>) =>
    doctorCheck(`github.${id}`, requirement, inspect);
  const checks = [
    await check(
      'repository',
      'Public, unarchived repository with the expected default branch.',
      async () => {
        const repo = z
          .object({
            full_name: z.string(),
            private: z.boolean(),
            archived: z.boolean(),
            default_branch: z.string(),
          })
          .parse(await read(base));
        return (
          repo.full_name === target.repository &&
          !repo.private &&
          !repo.archived &&
          repo.default_branch === target.branch
        );
      },
    ),
    await check(
      'rules',
      'Effective production-branch rules match the pinned organization ruleset.',
      async () =>
        matchesPinnedRules(
          await read(`${base}/rules/branches/${encodeURIComponent(target.branch)}`),
          target.ruleset,
        ),
    ),
    await check('production', 'The production environment accepts only the main branch.', () =>
      productionPolicy(read, environment, target.branch),
    ),
    await check(
      'credentials',
      'The production environment contains CLOUDFLARE_API_TOKEN.',
      async () => {
        const secrets = z
          .object({ secrets: z.array(z.object({ name: z.string() })) })
          .parse(await read(`${environment}/secrets`)).secrets;
        return secrets.some((secret) => secret.name === 'CLOUDFLARE_API_TOKEN');
      },
    ),
    await check(
      'variables',
      'Repository variables select the declared Cloudflare account and zone.',
      async () => {
        const values = variables.parse(await read(`${base}/actions/variables`)).variables;
        return (
          values.some(
            (value) => value.name === 'CLOUDFLARE_ACCOUNT_ID' && value.value === target.accountId,
          ) &&
          values.some(
            (value) => value.name === 'CLOUDFLARE_ZONE_ID' && value.value === target.zoneId,
          )
        );
      },
    ),
    await check(
      'analytics-variable',
      'The production environment declares a Web Analytics site token.',
      async () =>
        variables
          .parse(await read(`${environment}/variables`))
          .variables.some(
            (value) =>
              value.name === 'CLOUDFLARE_WEB_ANALYTICS_TOKEN' && value.value.trim().length > 0,
          ),
    ),
  ];
  if (target.preview !== undefined)
    checks.push(...(await previewChecks(target.preview, base, read, check)));
  return checks;
}
