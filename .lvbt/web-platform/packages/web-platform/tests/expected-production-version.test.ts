import { expect, test } from 'vitest';
import { verifyExpectedProductionVersion } from '../src/expected-production-version.js';
const expected = '1c4deaba-ee53-4c3f-ba65-176ae596cad5';
const config = { productionWorker: 'example-production' };

test('the expected version guard reads only the selected production namespace and rejects changed or split traffic', async () => {
  await Promise.resolve();
  const commands: string[][] = [];
  const execute = async (args: string[]) => {
    await Promise.resolve();
    commands.push(args);
    return JSON.stringify([
      { created_on: '2026-09-05T00:00:00Z', versions: [{ version_id: expected, percentage: 100 }] },
    ]);
  };
  await verifyExpectedProductionVersion(config, expected, '/saved/release', execute);
  expect(commands).toEqual([
    [
      'exec',
      'wrangler',
      'deployments',
      'list',
      '--name',
      config.productionWorker,
      '--config',
      '/saved/release/wrangler.jsonc',
      '--env',
      '',
      '--json',
    ],
  ]);
  await expect(
    verifyExpectedProductionVersion(config, expected, undefined, () =>
      Promise.resolve(
        JSON.stringify([
          {
            created_on: '2026-09-05T00:00:00Z',
            versions: [{ version_id: '2ae50b24-3d42-48d2-a784-627b60841961', percentage: 100 }],
          },
        ]),
      ),
    ),
  ).rejects.toThrow(/changed/);
  await expect(
    verifyExpectedProductionVersion(config, expected, undefined, () =>
      Promise.resolve(
        JSON.stringify([
          {
            created_on: '2026-09-05T00:00:00Z',
            versions: [
              { version_id: expected, percentage: 50 },
              { version_id: '2ae50b24-3d42-48d2-a784-627b60841961', percentage: 50 },
            ],
          },
        ]),
      ),
    ),
  ).rejects.toThrow();
});

test('omitted guards issue no command, invalid selectors fail before querying the provider', async () => {
  await Promise.resolve();
  let requests = 0;
  const execute = async () => {
    await Promise.resolve();
    requests++;
    return '[]';
  };
  await verifyExpectedProductionVersion(config, undefined, undefined, execute);
  await expect(
    verifyExpectedProductionVersion(config, 'not-a-version', undefined, execute),
  ).rejects.toThrow();
  expect(requests).toBe(0);
});
