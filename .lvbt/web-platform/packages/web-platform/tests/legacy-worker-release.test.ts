import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { packageLegacyWorkerRelease } from '../src/legacy-worker-release-artifact.js';
import { verifyRelease } from '../src/saved-release-artifact.js';
test('legacy Worker packaging retains reviewed migrations without rewriting the checkout config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'legacy-worker-migrations-'));
  try {
    const source = path.join(root, 'apps/site');
    await mkdir(path.join(source, '.wrangler/worker'), { recursive: true });
    await mkdir(path.join(source, 'dist'));
    await mkdir(path.join(source, 'migrations'));
    const original = JSON.stringify({
      name: 'app',
      assets: { directory: './dist', binding: 'ASSETS', run_worker_first: ['/api/*'] },
      d1_databases: [{ binding: 'DB', database_id: 'production' }],
      env: {
        preview: { name: 'app-preview', d1_databases: [{ binding: 'DB', database_id: 'preview' }] },
      },
    });
    await writeFile(path.join(source, 'wrangler.jsonc'), original);
    await writeFile(path.join(source, 'dist/index.html'), '<main>Reviewed app</main>');
    await writeFile(path.join(source, '.wrangler/worker/index.js'), 'export default {}');
    const sql = '-- exact reviewed bytes\r\nCREATE TABLE users(id TEXT);\r\n';
    await writeFile(path.join(source, 'migrations/0001_users.sql'), sql);
    const config = {
      repository: 'Example/app',
      appDirectory: 'apps/site',
      productionWorker: 'app',
      previewWorker: 'app-preview',
      productionUrl: 'https://example.org',
      previewUrl: 'https://preview.example.org',
      artifactPrefix: 'app-release',
      migrations: [{ binding: 'DB', directory: 'migrations' }],
      stagingWorkflow: {
        name: 'Deploy staging',
        path: '.github/workflows/deploy.yml',
        branch: 'main',
      },
      promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote app', branch: 'main' },
    };
    const destination = path.join(root, 'release');
    const release = await packageLegacyWorkerRelease(
      source,
      destination,
      { commit: 'a'.repeat(40), releaseId: '123' },
      config,
    );
    expect(await verifyRelease(destination)).toEqual(release);
    expect(
      await readFile(
        path.join(destination, '.wrangler/worker/migrations/DB/0001_users.sql'),
        'utf8',
      ),
    ).toBe(sql);
    expect(await readFile(path.join(source, 'wrangler.jsonc'), 'utf8')).toBe(original);
    const saved = JSON.parse(await readFile(path.join(destination, 'wrangler.jsonc'), 'utf8')) as {
      assets: { run_worker_first: string[] };
      env: { preview: { assets: { run_worker_first: string[] } } };
    };
    expect(saved.assets.run_worker_first).toEqual(['/api/*', '/lvbt-release.json']);
    expect(saved.env.preview.assets.run_worker_first).toEqual(saved.assets.run_worker_first);
    expect(
      await readFile(path.join(destination, '.wrangler/worker/release-original.js'), 'utf8'),
    ).toBe('export default {}');
    const entry = (await import(
      pathToFileURL(path.join(destination, '.wrangler/worker/index.js')).href
    )) as {
      default: { fetch(request: Request, env: unknown, context: unknown): Promise<Response> };
    };
    const marker = await entry.default.fetch(
      new Request('https://preview.example.org/lvbt-release.json'),
      { LVBT_DEPLOYMENT_ENV: 'preview' },
      {},
    );
    expect(await marker.json()).toEqual({ commit: 'a'.repeat(40), releaseId: '123' });
    expect(marker.headers.get('cache-control')).toBe('private, no-store');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
