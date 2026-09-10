import { expect, test } from 'vitest';
import { reconcileResources, type ProvisionResource } from '../src/provision-reconcile.ts';

function resource(
  id: string,
  state: { value: unknown },
  desired: unknown,
  writes: string[],
): ProvisionResource {
  return {
    id,
    read: () => Promise.resolve(structuredClone(state.value)),
    desired: () => desired,
    write: (_before, after) => {
      writes.push(id);
      state.value = structuredClone(after);
      return Promise.resolve();
    },
  };
}

test('plans without writes and an applied rerun makes no changes', async () => {
  const state = { value: null };
  const writes: string[] = [];
  const resources = [resource('account-variable', state, { value: 'account' }, writes)];
  const planned = await reconcileResources(resources, false);
  expect(planned.changed).toBe(false);
  expect(planned.operations[0]?.status).toBe('planned');
  expect(writes).toEqual([]);
  expect((await reconcileResources(resources, true)).changed).toBe(true);
  expect((await reconcileResources(resources, true)).changed).toBe(false);
  expect(writes).toEqual(['account-variable']);
});

test('an inaccessible resource stops the entire group before any writes', async () => {
  const writes: string[] = [];
  const inaccessible = resource('inaccessible', { value: null }, {}, writes);
  inaccessible.read = () => Promise.reject(new Error('private credential'));
  const result = await reconcileResources(
    [resource('first', { value: null }, {}, writes), inaccessible],
    true,
  );
  expect(result.ok).toBe(false);
  expect(writes).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('private credential');
});

test('preserves a concurrent edit between planning and application', async () => {
  const writes: string[] = [];
  const item = resource('variable', { value: 'original' }, 'desired', writes);
  let reads = 0;
  item.read = () => Promise.resolve(++reads === 1 ? 'original' : 'someone else changed it');
  const result = await reconcileResources([item], true);
  expect(result.ok).toBe(false);
  expect(result.operations[0]?.status).toBe('conflict');
  expect(writes).toEqual([]);
});

test('reports an ambiguous write and withholds remaining operations', async () => {
  const writes: string[] = [];
  const failed = resource('uncertain', { value: null }, {}, writes);
  failed.write = () => Promise.reject(new Error('credential in provider error'));
  const result = await reconcileResources(
    [failed, resource('later', { value: null }, {}, writes)],
    true,
  );
  expect(result.changed).toBeNull();
  expect(result.ok).toBe(false);
  expect(result.operations.map((operation) => operation.status)).toEqual([
    'unconfirmed',
    'withheld',
  ]);
  expect(writes).toEqual([]);
});
