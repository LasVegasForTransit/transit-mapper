import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { ProvisionResource } from './provision-reconcile.js';

const policy = z.object({ protected_branches: z.boolean(), custom_branch_policies: z.boolean() });
const environment = z.object({
  deployment_branch_policy: policy.nullable(),
  can_admins_bypass: z.boolean(),
  protection_rules: z.array(z.looseObject({ type: z.string() })),
});
const branch = z.object({ name: z.string(), type: z.string() });
const snapshot = environment.extend({ branches: z.array(branch).nullable() });
type Snapshot = z.infer<typeof snapshot>;
type EnvironmentWrite = (method: 'PUT' | 'POST', endpoint: string, body: unknown) => Promise<void>;

function protectionFields(state: Snapshot) {
  const timer = state.protection_rules.find((rule) => rule.type === 'wait_timer');
  const review = state.protection_rules.find((rule) => rule.type === 'required_reviewers');
  const reviewers = review
    ? z
        .object({
          prevent_self_review: z.boolean(),
          reviewers: z.array(
            z.object({ type: z.enum(['User', 'Team']), reviewer: z.object({ id: z.number() }) }),
          ),
        })
        .parse(review)
    : undefined;
  return {
    wait_timer: timer ? z.object({ wait_timer: z.number() }).parse(timer).wait_timer : 0,
    prevent_self_review: reviewers?.prevent_self_review ?? false,
    reviewers: reviewers?.reviewers.map(({ type, reviewer }) => ({ type, id: reviewer.id })) ?? [],
  };
}

export function provisionEnvironment(
  target: { repository: string; environment: string; branch: string },
  read: (endpoint: string) => Promise<unknown>,
  write: EnvironmentWrite,
): ProvisionResource {
  const endpoint = `repos/${target.repository}/environments/${encodeURIComponent(target.environment)}`;
  const branchEndpoint = `${endpoint}/deployment-branch-policies`;
  const desiredPolicy = { protected_branches: false, custom_branch_policies: true };
  const desiredBranch = { name: target.branch, type: 'branch' };
  const inspect = async (): Promise<Snapshot> => {
    const current = environment.parse(await read(endpoint));
    return {
      ...current,
      protection_rules: current.protection_rules.filter((rule) => rule.type !== 'branch_policy'),
      branches: current.deployment_branch_policy?.custom_branch_policies
        ? z.object({ branch_policies: z.array(branch) }).parse(await read(branchEndpoint))
            .branch_policies
        : null,
    };
  };
  return {
    id: 'github.production',
    read: inspect,
    desired: (input) => {
      const current = snapshot.parse(input);
      protectionFields(current);
      if (current.branches?.some((item) => !isDeepStrictEqual(item, desiredBranch)))
        throw new Error('Unexpected deployment branch policies require review.');
      if ((current.branches?.length ?? 0) > 1)
        throw new Error('Duplicate deployment branch policies require review.');
      return { ...current, deployment_branch_policy: desiredPolicy, branches: [desiredBranch] };
    },
    write: async (input) => {
      const before = snapshot.parse(input);
      if (!isDeepStrictEqual(before.deployment_branch_policy, desiredPolicy)) {
        await write('PUT', endpoint, {
          ...protectionFields(before),
          deployment_branch_policy: desiredPolicy,
        });
      }
      const current = await inspect();
      if (
        !isDeepStrictEqual(current.deployment_branch_policy, desiredPolicy) ||
        !isDeepStrictEqual(current.protection_rules, before.protection_rules) ||
        current.can_admins_bypass !== before.can_admins_bypass
      )
        throw new Error('Environment protections changed during policy activation.');
      if (current.branches?.length === 0) await write('POST', branchEndpoint, desiredBranch);
      else if (!isDeepStrictEqual(current.branches, [desiredBranch]))
        throw new Error('Deployment branch policies changed during policy activation.');
    },
  };
}

export function provisionEnvironmentPresence(
  target: { repository: string; environment: string },
  read: (endpoint: string) => Promise<unknown>,
  write: (method: 'PUT', endpoint: string, body: object) => Promise<void>,
): ProvisionResource {
  const selected = z
    .object({
      repository: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
      environment: z.string().regex(/^[A-Za-z0-9._-]+$/),
    })
    .parse(target);
  const endpoint = `repos/${selected.repository}/environments/${encodeURIComponent(selected.environment)}`;
  return {
    id: `github.environment.${selected.environment}`,
    read: async () => (await read(endpoint)) !== null,
    desired: () => true,
    write: () => write('PUT', endpoint, {}),
  };
}
