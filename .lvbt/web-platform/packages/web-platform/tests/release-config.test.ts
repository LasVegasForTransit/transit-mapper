import { expect, test } from 'vitest';
import { releaseConfigurationSchema } from '../src/release-config.js';
const config = {
  repository: 'Example/app',
  appDirectory: 'apps/site',
  productionUrl: 'https://example.org',
  previewUrl: 'https://preview.example.org',
  productionWorker: 'app',
  previewWorker: 'app-preview',
  artifactPrefix: 'app-release',
  stagingWorkflow: { name: 'Deploy staging', path: '.github/workflows/deploy-production.yml' },
  promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote app', branch: 'main' },
};

test('release tooling cannot run from a directory outside its checked repository', () => {
  for (const appDirectory of ['/tmp/app', '../app', 'apps/../../app']) {
    expect(releaseConfigurationSchema.safeParse({ ...config, appDirectory }).success).toBe(false);
  }
});

test('release tooling rejects mixed staging and production Workers or origins', () => {
  expect(releaseConfigurationSchema.safeParse({ ...config, previewWorker: 'app' }).success).toBe(
    false,
  );
  expect(
    releaseConfigurationSchema.safeParse({ ...config, previewUrl: 'https://example.org' }).success,
  ).toBe(false);
  expect(releaseConfigurationSchema.parse(config).stagingWorkflow.branch).toBe('main');
});

test('template release configuration requires named URL variables and infers only the Actions repository', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { default: os } = await import('node:os');
  const { default: path } = await import('node:path');
  const { readReleaseConfiguration } = await import('../src/release-config.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-config-env-'));
  try {
    await mkdir(path.join(root, '.lvbt'));
    const {
      repository: _repository,
      productionUrl: _productionUrl,
      previewUrl: _previewUrl,
      ...rest
    } = config;
    await writeFile(
      path.join(root, '.lvbt/tooling.json'),
      JSON.stringify({
        version: 1,
        release: {
          ...rest,
          productionUrlEnv: 'LVBT_PRODUCTION_URL',
          previewUrlEnv: 'LVBT_PREVIEW_URL',
        },
      }),
    );
    await expect(
      readReleaseConfiguration(root, { GITHUB_REPOSITORY: 'Example/app' }),
    ).rejects.toThrow('LVBT_PRODUCTION_URL');
    const resolved = await readReleaseConfiguration(root, {
      GITHUB_REPOSITORY: 'Example/app',
      LVBT_PRODUCTION_URL: 'https://example.org',
      LVBT_PREVIEW_URL: 'https://preview.example.org',
    });
    expect(resolved.repository).toBe('Example/app');
    expect(resolved.productionUrl).toBe('https://example.org');
    expect(resolved.previewUrl).toBe('https://preview.example.org');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
