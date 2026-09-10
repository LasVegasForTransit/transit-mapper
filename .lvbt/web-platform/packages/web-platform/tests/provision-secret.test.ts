import { expect, test } from 'vitest';
import { provisionEnvironmentSecret } from '../src/provision-secret.ts';
import { reconcileResources } from '../src/provision-reconcile.ts';

test('sets a missing environment secret without reading its value', async () => {
  const secrets = new Set<string>();
  let writes = 0;
  const resource = provisionEnvironmentSecret(
    {
      repository: 'LasVegasForTransit/labs',
      environment: 'production',
      name: 'CLOUDFLARE_API_TOKEN',
    },
    () => Promise.resolve({ secrets: [...secrets].map((name) => ({ name })) }),
    () => {
      writes += 1;
      secrets.add('CLOUDFLARE_API_TOKEN');
      return Promise.resolve();
    },
  );

  expect((await reconcileResources([resource], false)).operations[0]?.status).toBe('planned');
  expect((await reconcileResources([resource], true)).ok).toBe(true);
  expect(writes).toBe(1);
  expect((await reconcileResources([resource], true)).changed).toBe(false);
  expect(writes).toBe(1);
});
