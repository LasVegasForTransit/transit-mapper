import { expect, test } from 'vitest';
import { provisionWorkerPresence } from '../src/provision-worker.ts';
import { reconcileResources } from '../src/provision-reconcile.ts';

test('uploads a missing Worker once and verifies its provider identity', async () => {
  const workers: { id: string }[] = [];
  let uploads = 0;
  const resource = provisionWorkerPresence(
    { name: 'lvbt-labs-map' },
    () => Promise.resolve(workers),
    () => {
      uploads += 1;
      workers.push({ id: 'lvbt-labs-map' });
      return Promise.resolve();
    },
  );

  expect((await reconcileResources([resource], false)).operations[0]?.status).toBe('planned');
  expect(uploads).toBe(0);
  expect((await reconcileResources([resource], true)).ok).toBe(true);
  expect(uploads).toBe(1);
  expect((await reconcileResources([resource], true)).changed).toBe(false);
  expect(uploads).toBe(1);
});

test('refuses duplicate Worker identities without uploading', async () => {
  let uploads = 0;
  const resource = provisionWorkerPresence(
    { name: 'lvbt-labs-map' },
    () => Promise.resolve([{ id: 'lvbt-labs-map' }, { id: 'lvbt-labs-map' }]),
    () => {
      uploads += 1;
      return Promise.resolve();
    },
  );

  expect((await reconcileResources([resource], true)).ok).toBe(false);
  expect(uploads).toBe(0);
});
