import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { readReleaseConfiguration } from '../src/release-config.js';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const config = {
  repository: 'Example/app',
  appDirectory: 'apps/site',
  productionUrl: 'https://example.org',
  previewUrl: 'https://preview.example.org',
  productionWorker: 'app',
  previewWorker: 'app-preview',
  artifactPrefix: 'app-release',
  stagingWorkflow: { name: 'Deploy staging', path: '.github/workflows/deploy.yml' },
  promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote app', branch: 'main' },
};
async function fixture(value: unknown) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workers-selector-'));
  roots.push(root);
  await mkdir(path.join(root, '.lvbt'));
  await writeFile(
    path.join(root, '.lvbt/tooling.json'),
    JSON.stringify({ version: 1, release: value }),
  );
  return root;
}
test('a reviewed public account label resolves from the declared environment in common and profile configurations', async () => {
  const selected = { ...config, workersDevSubdomainEnv: 'LVBT_WORKERS_DEV_SUBDOMAIN' };
  const { repository, stagingWorkflow, promotionWorkflow, ...profile } = selected;
  for (const release of [
    selected,
    { repository, stagingWorkflow, promotionWorkflow, apps: { site: profile } },
  ]) {
    const root = await fixture(release);
    const value = await readReleaseConfiguration(
      root,
      { LVBT_WORKERS_DEV_SUBDOMAIN: 'reviewed-account' },
      'apps' in release ? 'site' : undefined,
    );
    expect(value.workersDevSubdomain).toBe('reviewed-account');
    expect(value).not.toHaveProperty('workersDevSubdomainEnv');
  }
});
test.each([undefined, '', 'https://other.workers.dev', 'other.workers.dev', 'UPPERCASE'])(
  'missing or unsafe account label fails closed (%s)',
  async (value) => {
    const root = await fixture({ ...config, workersDevSubdomainEnv: 'LVBT_WORKERS_DEV_SUBDOMAIN' });
    await expect(
      readReleaseConfiguration(root, { LVBT_WORKERS_DEV_SUBDOMAIN: value }),
    ).rejects.toThrow();
  },
);
test('conflicting literal and environment account labels are rejected', async () => {
  const root = await fixture({
    ...config,
    workersDevSubdomain: 'literal-account',
    workersDevSubdomainEnv: 'LVBT_WORKERS_DEV_SUBDOMAIN',
  });
  await expect(
    readReleaseConfiguration(root, { LVBT_WORKERS_DEV_SUBDOMAIN: 'env-account' }),
  ).rejects.toThrow();
});
test('existing literal declarations retain their account label', async () => {
  const root = await fixture({ ...config, workersDevSubdomain: 'literal-account' });
  expect((await readReleaseConfiguration(root, {})).workersDevSubdomain).toBe('literal-account');
});
test('shared release workflows forward the declared public account variable wherever config is read', async () => {
  for (const file of [
    'release-build.yml',
    'release-source.yml',
    'release-publish.yml',
    'release-pr-preview.yml',
    'release-attest.yml',
  ]) {
    const workflow = await readFile(
      new URL(`../../../.github/workflows/${file}`, import.meta.url),
      'utf8',
    );
    const required = workflow.match(
      /LVBT_PREVIEW_BINDINGS: \$\{\{ vars.LVBT_PREVIEW_BINDINGS \}\}/g,
    )?.length;
    expect(
      workflow.match(/LVBT_WORKERS_DEV_SUBDOMAIN: \$\{\{ vars.LVBT_WORKERS_DEV_SUBDOMAIN \}\}/g)
        ?.length,
    ).toBe(required);
  }
});
