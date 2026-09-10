import { expect, test } from 'vitest';
import { provisionRepositoryVariable, provisionVariables } from '../src/provision-variables.ts';
import { reconcileResources } from '../src/provision-reconcile.ts';

test('reconciles only declared nonsecret variables and preserves unrelated values', async () => {
  const variables = new Map([
    ['UNRELATED', 'keep'],
    ['CLOUDFLARE_ZONE_ID', 'old-zone'],
  ]);
  const writes: { method: string; endpoint: string }[] = [];
  const resources = provisionVariables(
    { repository: 'LasVegasForTransit/labs', accountId: 'account', zoneId: 'zone' },
    () => Promise.resolve({ variables: [...variables].map(([name, value]) => ({ name, value })) }),
    (method, endpoint, body) => {
      writes.push({ method, endpoint });
      variables.set(body.name, body.value);
      return Promise.resolve();
    },
  );
  expect(
    (await reconcileResources(resources, false)).operations.map((operation) => operation.status),
  ).toEqual(['planned', 'planned']);
  expect(writes).toHaveLength(0);
  expect((await reconcileResources(resources, true)).ok).toBe(true);
  expect(writes.map((write) => write.method)).toEqual(['POST', 'PATCH']);
  expect(variables.get('UNRELATED')).toBe('keep');
  expect(variables.get('CLOUDFLARE_ACCOUNT_ID')).toBe('account');
  expect(variables.get('CLOUDFLARE_ZONE_ID')).toBe('zone');
  expect((await reconcileResources(resources, true)).changed).toBe(false);
  expect(writes).toHaveLength(2);
});

test('reconciles one explicitly named repository variable', async () => {
  let value: string | null = null;
  const resource = provisionRepositoryVariable(
    {
      repository: 'LasVegasForTransit/labs',
      name: 'CLOUDFLARE_PREVIEWS_ENABLED',
      value: 'true',
    },
    () =>
      Promise.resolve({
        variables: value === null ? [] : [{ name: 'CLOUDFLARE_PREVIEWS_ENABLED', value }],
      }),
    (_method, _endpoint, body) => {
      value = body.value;
      return Promise.resolve();
    },
  );
  expect((await reconcileResources([resource], true)).ok).toBe(true);
  expect(value).toBe('true');
  expect((await reconcileResources([resource], true)).changed).toBe(false);
});

test('rejects an unsafe repository variable API target', () => {
  expect(() =>
    provisionRepositoryVariable(
      { repository: '../other', name: 'ENABLED', value: 'true' },
      () => Promise.resolve({ variables: [] }),
      () => Promise.resolve(),
    ),
  ).toThrow();
});
