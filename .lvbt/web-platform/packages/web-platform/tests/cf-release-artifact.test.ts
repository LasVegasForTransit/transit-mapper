import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { packageCfRelease } from '../src/cf-release-artifact.js';
import { verifyRelease } from '../src/saved-release-artifact.js';
const configuration = {
  repository: 'Example/app',
  appDirectory: 'apps/deploy',
  productionUrl: 'https://example.org',
  previewUrl: 'https://preview.example.org',
  productionWorker: 'app',
  previewWorker: 'app-preview',
  artifactPrefix: 'app-release',
  stagingWorkflow: { name: 'Deploy staging', path: '.github/workflows/deploy.yml', branch: 'main' },
  promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote app', branch: 'main' },
};
test('a cf static build becomes a reviewed Worker release through the existing inventory and verifier', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cf-release-'));
  try {
    const source = path.join(root, 'source');
    const worker = path.join(source, '.cloudflare/output/v0/workers/default');
    await mkdir(path.join(worker, 'assets'), { recursive: true });
    await writeFile(path.join(worker, 'assets/index.html'), '<h1>Reviewed static app</h1>');
    await writeFile(
      path.join(worker, 'worker.config.json'),
      JSON.stringify({
        name: 'app',
        compatibilityDate: '2026-08-31',
        assets: { notFoundHandling: '404-page' },
        observability: { enabled: true },
        previewUrls: true,
      }),
    );
    const directory = path.join(root, 'release');
    const release = await packageCfRelease(
      source,
      directory,
      { commit: 'a'.repeat(40), releaseId: '123' },
      configuration,
    );
    expect(await verifyRelease(directory)).toEqual(release);
    const config = z
      .object({
        name: z.string(),
        assets: z.object({ directory: z.string() }),
        vars: z.object({ LVBT_DEPLOYMENT_ENV: z.string() }),
        env: z.object({
          preview: z.object({
            name: z.string(),
            routes: z.array(z.object({ pattern: z.string(), custom_domain: z.boolean() })),
            vars: z.object({ LVBT_DEPLOYMENT_ENV: z.string() }),
          }),
        }),
      })
      .parse(JSON.parse(await readFile(path.join(directory, 'wrangler.jsonc'), 'utf8')));
    expect(config.name).toBe('app');
    expect(config.env.preview.name).toBe('app-preview');
    expect(config.assets.directory).toBe('./dist');
    expect(config.env.preview.routes).toEqual([
      { pattern: 'preview.example.org', custom_domain: true },
    ]);
    expect(config.vars.LVBT_DEPLOYMENT_ENV).toBe('production');
    expect(config.env.preview.vars.LVBT_DEPLOYMENT_ENV).toBe('preview');
    expect(await readFile(path.join(directory, 'dist/index.html'), 'utf8')).toBe(
      '<h1>Reviewed static app</h1>',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('static cf normalization cannot silently discard production data bindings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cf-bound-release-'));
  try {
    const worker = path.join(root, '.cloudflare/output/v0/workers/default');
    await mkdir(path.join(worker, 'assets'), { recursive: true });
    await writeFile(
      path.join(worker, 'worker.config.json'),
      JSON.stringify({
        name: 'app',
        compatibilityDate: '2026-08-31',
        assets: {},
        d1Databases: [{ binding: 'DB', databaseId: 'production' }],
      }),
    );
    await expect(
      packageCfRelease(
        root,
        path.join(root, 'release'),
        { commit: 'a'.repeat(40), releaseId: '123' },
        configuration,
      ),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
