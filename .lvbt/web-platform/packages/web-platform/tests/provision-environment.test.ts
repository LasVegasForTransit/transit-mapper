import { expect, test } from 'vitest';
import {
  provisionEnvironment,
  provisionEnvironmentPresence,
} from '../src/provision-environment.ts';
import { reconcileResources } from '../src/provision-reconcile.ts';

function fixture() {
  const state = {
    deployment_branch_policy: null as null | {
      protected_branches: boolean;
      custom_branch_policies: boolean;
    },
    can_admins_bypass: false,
    protection_rules: [
      { type: 'wait_timer', wait_timer: 5 },
      {
        type: 'required_reviewers',
        prevent_self_review: true,
        reviewers: [{ type: 'Team', reviewer: { id: 42 } }],
      },
    ],
  };
  const policies: { name: string; type: string }[] = [];
  const writes: { method: string; body: unknown }[] = [];
  const resource = provisionEnvironment(
    { repository: 'example/labs', environment: 'production', branch: 'main' },
    (endpoint) => {
      if (endpoint.endsWith('/deployment-branch-policies')) {
        if (!state.deployment_branch_policy?.custom_branch_policies)
          return Promise.reject(new Error('Policies are disabled.'));
        return Promise.resolve({ branch_policies: structuredClone(policies) });
      }
      return Promise.resolve(structuredClone(state));
    },
    (method, _endpoint, body) => {
      writes.push({ method, body });
      if (method === 'PUT')
        state.deployment_branch_policy = {
          protected_branches: false,
          custom_branch_policies: true,
        };
      else policies.push({ name: 'main', type: 'branch' });
      return Promise.resolve();
    },
  );
  return { state, policies, writes, resource };
}

test('plans, preserves protections, enables main-only deployments, and reruns without writes', async () => {
  const { resource, writes } = fixture();
  expect((await reconcileResources([resource], false)).ok).toBe(true);
  expect(writes).toEqual([]);
  expect((await reconcileResources([resource], true)).ok).toBe(true);
  expect(writes).toEqual([
    {
      method: 'PUT',
      body: {
        wait_timer: 5,
        prevent_self_review: true,
        reviewers: [{ type: 'Team', id: 42 }],
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      },
    },
    { method: 'POST', body: { name: 'main', type: 'branch' } },
  ]);
  expect((await reconcileResources([resource], true)).changed).toBe(false);
  expect(writes).toHaveLength(2);
});

test('preserves unexpected branch policies for review', async () => {
  const { resource, state, policies, writes } = fixture();
  state.deployment_branch_policy = { protected_branches: false, custom_branch_policies: true };
  policies.push({ name: 'release/*', type: 'branch' });
  expect((await reconcileResources([resource], true)).ok).toBe(false);
  expect(writes).toEqual([]);
});

test('resumes after custom policy activation without repeating the environment update', async () => {
  const { resource, state, writes } = fixture();
  state.deployment_branch_policy = { protected_branches: false, custom_branch_policies: true };
  expect((await reconcileResources([resource], true)).ok).toBe(true);
  expect(writes.map((write) => write.method)).toEqual(['POST']);
});

test('withholds branch creation when a provider changes existing protections', async () => {
  let enabled = false;
  const writes: string[] = [];
  const resource = provisionEnvironment(
    { repository: 'example/labs', environment: 'production', branch: 'main' },
    (endpoint) =>
      Promise.resolve(
        endpoint.endsWith('/deployment-branch-policies')
          ? { branch_policies: [] }
          : {
              deployment_branch_policy: enabled
                ? { protected_branches: false, custom_branch_policies: true }
                : null,
              can_admins_bypass: enabled,
              protection_rules: [],
            },
      ),
    (method) => {
      writes.push(method);
      enabled = true;
      return Promise.resolve();
    },
  );
  const result = await reconcileResources([resource], true);
  expect(result.ok).toBe(false);
  expect(result.changed).toBeNull();
  expect(writes).toEqual(['PUT']);
});

test('creates a missing named environment and preserves an existing environment', async () => {
  let present = false;
  const writes: string[] = [];
  const resource = provisionEnvironmentPresence(
    { repository: 'example/labs', environment: 'preview' },
    () => Promise.resolve(present ? { id: 42 } : null),
    (_method, endpoint) => {
      writes.push(endpoint);
      present = true;
      return Promise.resolve();
    },
  );
  expect((await reconcileResources([resource], false)).operations[0]?.status).toBe('planned');
  expect((await reconcileResources([resource], true)).ok).toBe(true);
  expect(writes).toEqual(['repos/example/labs/environments/preview']);
  expect((await reconcileResources([resource], true)).changed).toBe(false);
});

test('rejects an unsafe environment API target', () => {
  expect(() =>
    provisionEnvironmentPresence(
      { repository: '../other', environment: '../production' },
      () => Promise.resolve(null),
      () => Promise.resolve(),
    ),
  ).toThrow();
});
