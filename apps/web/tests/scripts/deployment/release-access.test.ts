import { expect, test } from 'vitest';
import { releaseBrowserCredentials } from '../../../scripts/deployment/release-access';
const config = {
  productionUrl: 'https://map.lasvegasfortransit.org',
  previewUrl: 'https://transitmapper-preview.las-vegas-for-better-transit.workers.dev',
  productionWorker: 'transitmapper',
  previewWorker: 'transitmapper-preview',
  workersDevSubdomain: 'las-vegas-for-better-transit',
};
const env = { CF_ACCESS_CLIENT_ID: 'test-id', CF_ACCESS_CLIENT_SECRET: 'test-secret' };
test('product acceptance authenticates only the declared preview and never production or local dev', async () => {
  expect(await releaseBrowserCredentials(config.previewUrl, config, env)).toEqual({
    clientId: 'test-id',
    clientSecret: 'test-secret',
  });
  expect(await releaseBrowserCredentials(config.productionUrl, config, env)).toBeUndefined();
  expect(await releaseBrowserCredentials('http://127.0.0.1:4321', config, env)).toBeUndefined();
});
test('a cloned staging name in another account cannot receive Access credentials', async () => {
  await expect(
    releaseBrowserCredentials(
      'https://transitmapper-preview.foreign-account.workers.dev',
      config,
      env,
    ),
  ).rejects.toThrow();
});
