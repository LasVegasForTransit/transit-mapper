import { expect, test } from 'vitest';
import { provisionRoutes } from '../src/provision-routes.ts';
import { reconcileResources } from '../src/provision-reconcile.ts';

const target = {
  hostname: 'labs.example.org',
  workers: [
    { slug: 'home', name: 'lvbt-labs-home' },
    { slug: 'map', name: 'lvbt-labs-map' },
    { slug: 'map-tools', name: 'lvbt-labs-map-tools' },
  ],
};

test('creates exact and subtree routes without altering other hosts and reruns without writes', async () => {
  const routes = [{ pattern: 'www.example.org/*', script: 'website' }];
  const writes: unknown[] = [];
  const resources = provisionRoutes(
    target,
    () => Promise.resolve(routes),
    (route) => {
      writes.push(route);
      routes.push(route);
      return Promise.resolve();
    },
  );
  expect((await reconcileResources(resources, false)).ok).toBe(true);
  expect(writes).toEqual([]);
  expect((await reconcileResources(resources, true)).ok).toBe(true);
  expect(routes.map((route) => route.pattern)).toEqual([
    'www.example.org/*',
    'labs.example.org/*',
    'labs.example.org/map',
    'labs.example.org/map/*',
    'labs.example.org/map-tools',
    'labs.example.org/map-tools/*',
  ]);
  expect((await reconcileResources(resources, true)).changed).toBe(false);
  expect(writes).toHaveLength(5);
});

test.each([
  { pattern: 'labs.example.org/map', script: 'other-owner' },
  { pattern: 'labs.example.org/map*', script: 'lvbt-labs-map' },
  { pattern: '*.example.org/*', script: 'other-owner' },
  { pattern: 'https://labs.example.org/map', script: 'other-owner' },
  { pattern: 'labs.example.org/map', script: null },
])('does not overwrite or bypass a conflicting route: $pattern', async (route) => {
  let writes = 0;
  const result = await reconcileResources(
    provisionRoutes(
      target,
      () => Promise.resolve([route]),
      () => {
        writes += 1;
        return Promise.resolve();
      },
    ),
    true,
  );
  expect(result.ok).toBe(false);
  expect(writes).toBe(0);
});
