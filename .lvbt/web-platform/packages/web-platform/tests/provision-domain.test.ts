import { expect, test } from 'vitest';
import { provisionCustomDomain } from '../src/provision-domain.ts';
import { reconcileResources } from '../src/provision-reconcile.ts';

const target = {
  accountId: 'account',
  zoneId: 'zone',
  zoneName: 'example.org',
  hostname: 'labs.example.org',
  service: 'lvbt-labs-home',
};

test('attaches one Worker custom domain and reruns without writes', async () => {
  const domains: unknown[] = [];
  const writes: unknown[] = [];
  const resource = provisionCustomDomain(
    target,
    () => Promise.resolve(domains),
    (domain) => {
      writes.push(domain);
      domains.push({ id: 'domain', ...domain });
      return Promise.resolve();
    },
  );

  expect((await reconcileResources([resource], false)).operations[0]?.status).toBe('planned');
  expect(writes).toEqual([]);
  expect((await reconcileResources([resource], true)).ok).toBe(true);
  expect(writes).toEqual([
    {
      zone_id: 'zone',
      zone_name: 'example.org',
      hostname: 'labs.example.org',
      service: 'lvbt-labs-home',
    },
  ]);
  expect((await reconcileResources([resource], true)).changed).toBe(false);
  expect(writes).toHaveLength(1);
});

test('refuses a hostname already attached to another Worker or zone', async () => {
  let writes = 0;
  const resource = provisionCustomDomain(
    target,
    () =>
      Promise.resolve([
        {
          id: 'domain',
          zone_id: 'other-zone',
          zone_name: 'example.org',
          hostname: 'labs.example.org',
          service: 'other-worker',
        },
      ]),
    () => {
      writes += 1;
      return Promise.resolve();
    },
  );

  expect((await reconcileResources([resource], true)).ok).toBe(false);
  expect(writes).toBe(0);
});
