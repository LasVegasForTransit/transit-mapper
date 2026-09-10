import { expect, test } from 'vitest';
import { provisionAnalytics } from '../src/provision-analytics.ts';
import { reconcileResources } from '../src/provision-reconcile.ts';

const target = {
  accountId: 'account',
  zoneId: 'zone',
  hostname: 'labs.example.org',
  repository: 'LasVegasForTransit/labs',
  environment: 'production',
};

test('creates one analytics site, publishes its token, and reruns without writes', async () => {
  const sites: unknown[] = [];
  const variables = new Map([['UNRELATED', 'keep']]);
  const siteWrites: unknown[] = [];
  const variableWrites: unknown[] = [];
  const resources = provisionAnalytics(target, {
    readSites: () => Promise.resolve(sites),
    createSite: (body) => {
      siteWrites.push(body);
      sites.push({
        site_tag: 'site',
        site_token: 'public-token',
        rules: [{ host: target.hostname, inclusive: true, is_paused: false }],
      });
      return Promise.resolve();
    },
    readVariables: () =>
      Promise.resolve({ variables: [...variables].map(([name, value]) => ({ name, value })) }),
    writeVariable: (method, endpoint, body) => {
      variableWrites.push({ method, endpoint, body });
      variables.set(body.name, body.value);
      return Promise.resolve();
    },
  });

  expect(
    (await reconcileResources(resources, false)).operations.map(({ status }) => status),
  ).toEqual(['planned', 'planned']);
  expect((await reconcileResources(resources, true)).ok).toBe(true);
  expect(siteWrites).toEqual([{ auto_install: false, host: target.hostname, zone_tag: 'zone' }]);
  expect(variableWrites).toEqual([
    {
      method: 'POST',
      endpoint: 'repos/LasVegasForTransit/labs/environments/production/variables',
      body: { name: 'CLOUDFLARE_WEB_ANALYTICS_TOKEN', value: 'public-token' },
    },
  ]);
  expect(variables.get('UNRELATED')).toBe('keep');
  expect((await reconcileResources(resources, true)).changed).toBe(false);
  expect(siteWrites).toHaveLength(1);
  expect(variableWrites).toHaveLength(1);
});

test('updates a stale analytics variable without creating another site', async () => {
  const sites = [
    {
      site_tag: 'site',
      site_token: 'current-token',
      rules: [{ host: target.hostname, inclusive: true, is_paused: false }],
    },
  ];
  const variables = new Map([['CLOUDFLARE_WEB_ANALYTICS_TOKEN', 'stale-token']]);
  let siteWrites = 0;
  const resources = provisionAnalytics(target, {
    readSites: () => Promise.resolve(sites),
    createSite: () => {
      siteWrites += 1;
      return Promise.resolve();
    },
    readVariables: () =>
      Promise.resolve({ variables: [...variables].map(([name, value]) => ({ name, value })) }),
    writeVariable: (_method, _endpoint, body) => {
      variables.set(body.name, body.value);
      return Promise.resolve();
    },
  });

  expect((await reconcileResources(resources, true)).ok).toBe(true);
  expect(siteWrites).toBe(0);
  expect(variables.get('CLOUDFLARE_WEB_ANALYTICS_TOKEN')).toBe('current-token');
});

test('refuses duplicate or conflicting analytics sites', async () => {
  for (const sites of [
    [
      {
        site_tag: 'one',
        site_token: 'one',
        rules: [{ host: target.hostname, inclusive: true, is_paused: false }],
      },
      {
        site_tag: 'two',
        site_token: 'two',
        rules: [{ host: target.hostname, inclusive: true, is_paused: false }],
      },
    ],
    [
      {
        site_tag: 'paused',
        site_token: 'paused',
        rules: [{ host: target.hostname, inclusive: true, is_paused: true }],
      },
    ],
  ]) {
    let writes = 0;
    const resources = provisionAnalytics(target, {
      readSites: () => Promise.resolve(sites),
      createSite: () => {
        writes += 1;
        return Promise.resolve();
      },
      readVariables: () => Promise.resolve({ variables: [] }),
      writeVariable: () => {
        writes += 1;
        return Promise.resolve();
      },
    });
    expect((await reconcileResources(resources, true)).ok).toBe(false);
    expect(writes).toBe(0);
  }
});
