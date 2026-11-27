import { isDeepStrictEqual } from 'node:util';
const selectedPolicy = { protected_branches: false, custom_branch_policies: true };
export function hasBranchPolicy(value, branch) {
  return (
    isDeepStrictEqual(value?.deployment_branch_policy, selectedPolicy) &&
    value?.branch_policies?.length === 1 &&
    value.branch_policies[0].name === branch &&
    value.branch_policies[0].type === 'branch'
  );
}
export async function reconcileBranchPolicy(endpoint, branch, { read, write }) {
  const current = await read(endpoint);
  const branchEndpoint = `${endpoint}/deployment-branch-policies`;
  const branches = current?.deployment_branch_policy?.custom_branch_policies
    ? (await read(branchEndpoint)).branch_policies
    : [];
  if (
    branches.some((item) => item.name !== branch || item.type !== 'branch') ||
    branches.length > 1
  )
    throw new Error('Unexpected deployment branch policies require review.');
  if (!isDeepStrictEqual(current?.deployment_branch_policy, selectedPolicy)) {
    await write('PUT', endpoint, {
      deployment_branch_policy: selectedPolicy,
      ...approvalFields(current),
    });
  }
  const latest = await read(endpoint);
  if (!isDeepStrictEqual(latest.deployment_branch_policy, selectedPolicy))
    throw new Error('Environment policy changed while restricting its branch.');
  const found = (await read(branchEndpoint)).branch_policies;
  if (found.length === 0) await write('POST', branchEndpoint, { name: branch, type: 'branch' });
  else if (!hasBranchPolicy({ ...latest, branch_policies: found }, branch))
    throw new Error('Deployment branch policy changed during setup.');
}

function approvalFields(current) {
  const rules = current?.protection_rules ?? [];
  const review = rules.find((rule) => rule.type === 'required_reviewers');
  return {
    wait_timer: rules.find((rule) => rule.type === 'wait_timer')?.wait_timer ?? 0,
    prevent_self_review: review?.prevent_self_review ?? false,
    reviewers: (review?.reviewers ?? []).map(({ type, reviewer }) => ({ type, id: reviewer.id })),
  };
}
