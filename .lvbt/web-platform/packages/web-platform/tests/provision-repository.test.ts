import { expect, test } from 'vitest';
import { reconcileResources } from '../src/provision-reconcile.ts';
import { provisionRepository } from '../src/provision-repository.ts';

const desired = {
  full_name: 'LasVegasForTransit/new-lab',
  private: false,
  archived: false,
  default_branch: 'main',
  allow_merge_commit: false,
  allow_squash_merge: false,
  allow_rebase_merge: true,
};

test('creates a missing public organization repository once', async () => {
  let state: unknown = null;
  const writes: { method: string; endpoint: string; body: unknown }[] = [];
  const resource = provisionRepository(
    { repository: desired.full_name, branch: 'main' },
    () => Promise.resolve(state),
    (method, endpoint, body) => {
      writes.push({ method, endpoint, body });
      state = desired;
      return Promise.resolve();
    },
  );

  expect((await reconcileResources([resource], false)).operations[0]?.status).toBe('planned');
  expect(writes).toEqual([]);
  expect((await reconcileResources([resource], true)).ok).toBe(true);
  expect(writes).toEqual([
    {
      method: 'POST',
      endpoint: 'orgs/LasVegasForTransit/repos',
      body: {
        name: 'new-lab',
        private: false,
        auto_init: false,
        allow_merge_commit: false,
        allow_squash_merge: false,
        allow_rebase_merge: true,
      },
    },
  ]);
  expect((await reconcileResources([resource], true)).changed).toBe(false);
  expect(writes).toHaveLength(1);
});

test('reconciles managed settings on an existing repository', async () => {
  let state: unknown = { ...desired, private: true, allow_merge_commit: true };
  const writes: { method: string; endpoint: string }[] = [];
  const resource = provisionRepository(
    { repository: desired.full_name, branch: 'main' },
    () => Promise.resolve(state),
    (method, endpoint) => {
      writes.push({ method, endpoint });
      state = desired;
      return Promise.resolve();
    },
  );

  expect((await reconcileResources([resource], true)).ok).toBe(true);
  expect(writes).toEqual([{ method: 'PATCH', endpoint: 'repos/LasVegasForTransit/new-lab' }]);
});
