import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { readReleaseConfiguration } from '../src/release-config.js';

const common = {
  repository: 'Example/labs',
  stagingWorkflow: { name: 'Deploy staging', path: '.github/workflows/deploy.yml' },
  promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote lab', branch: 'main' },
};
const home = {
  appDirectory: 'apps/home',
  productionWorker: 'home',
  previewWorker: 'home-preview',
  productionUrl: 'https://home.example.org',
  previewUrl: 'https://preview.home.example.org',
  artifactPrefix: 'home-release',
};
const second = {
  appDirectory: 'apps/second',
  productionWorker: 'second',
  previewWorker: 'second-preview',
  productionUrl: 'https://second.example.org',
  previewUrl: 'https://preview.second.example.org',
  artifactPrefix: 'second-release',
};
async function configuration(release: unknown, operation: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-profiles-'));
  try {
    await mkdir(path.join(root, '.lvbt'));
    await writeFile(path.join(root, '.lvbt/tooling.json'), JSON.stringify({ version: 1, release }));
    await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('named apps select distinct retained artifacts and cannot silently choose one app', async () => {
  await configuration({ ...common, apps: { home, second } }, async (root) => {
    await expect(readReleaseConfiguration(root, {})).rejects.toThrow('Select --app');
    expect(await readReleaseConfiguration(root, {}, 'home')).toMatchObject({
      ...home,
      profile: 'home',
    });
    expect(await readReleaseConfiguration(root, { LVBT_RELEASE_APP: 'second' })).toMatchObject({
      ...second,
      profile: 'second',
    });
    await expect(readReleaseConfiguration(root, {}, 'missing')).rejects.toThrow(
      'Unknown release app',
    );
  });
});
test('every profile is validated and cannot reuse another app artifact or provider identity', async () => {
  for (const override of [
    { artifactPrefix: home.artifactPrefix },
    { productionWorker: home.productionWorker },
    { appDirectory: '../outside' },
    { repository: 'Another/repo' },
  ]) {
    await configuration(
      { ...common, apps: { home, second: { ...second, ...override } } },
      async (root) => {
        await expect(readReleaseConfiguration(root, {}, 'home')).rejects.toThrow();
      },
    );
  }
});

test('nested public paths share one reviewed origin while keeping profile namespaces and endpoints distinct', async () => {
  await configuration(
    {
      ...common,
      apps: {
        home,
        second: { ...second, productionUrl: home.productionUrl, publicPath: '/second/' },
      },
    },
    async (root) => {
      expect(await readReleaseConfiguration(root, {}, 'second')).toMatchObject({
        publicPath: '/second/',
      });
    },
  );
  for (const publicPath of ['//foreign/', '/second/../', '/second', '/second/?query', '/%2e%2e/']) {
    await configuration(
      { ...common, apps: { home, second: { ...second, publicPath } } },
      async (root) => {
        await expect(readReleaseConfiguration(root, {}, 'home')).rejects.toThrow();
      },
    );
  }
});
