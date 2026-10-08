import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { generateTypedWorkerCompatibility } from '../src/typed-worker-compatibility.js';

test('compatibility config comes from both canonical modes and relocates future build and frozen SQL inputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'typed-compatibility-'));
  try {
    const source = path.join(root, 'apps/deploy');
    const destination = path.join(root, 'apps/site');
    await mkdir(source, { recursive: true });
    await mkdir(destination);
    await writeFile(
      path.join(source, 'cloudflare.config.mjs'),
      `export default ({mode}) => ({worker:{
      name:mode==='preview'?'app-preview':'app',entrypoint:'../site/.wrangler/worker/index.js',
      compatibilityDate:'2026-08-31',domains:['example.org'],
      unsafe:{metadata:{keep_bindings:['secret_text','secret_key']}},
      assets:{runWorkerFirst:mode==='preview'?true:['/api/*']},
      env:{ASSETS:{type:'assets'},DB:{type:'d1',name:'production',id:'production-id'},TOKEN:{type:'secret'}}
    }})`,
    );
    const config = {
      repository: 'Example/app',
      appDirectory: 'apps/deploy',
      productionWorker: 'app',
      previewWorker: 'app-preview',
      productionUrl: 'https://example.org',
      previewUrl: 'https://preview.example.org',
      artifactPrefix: 'app-release',
      typedConfig: 'cloudflare.config.mjs',
      assetsDirectory: '../site/dist',
      migrations: [{ binding: 'DB', directory: '../site/sql' }],
      previewBindings: {
        ASSETS: { type: 'assets' },
        DB: { type: 'd1', name: 'preview', id: 'preview-id' },
        TOKEN: { type: 'secret' },
      },
      stagingWorkflow: {
        name: 'Deploy staging',
        path: '.github/workflows/deploy.yml',
        branch: 'main',
      },
      promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote app', branch: 'main' },
    };
    const generated = await generateTypedWorkerCompatibility(source, destination, config);
    expect(generated).toMatchObject({
      main: '.wrangler/worker/index.js',
      assets: { directory: 'dist', run_worker_first: ['/api/*', '/lvbt-release.json'] },
      unsafe: { metadata: { keep_bindings: ['secret_text', 'secret_key'] } },
      d1_databases: [{ migrations_dir: 'sql', database_id: 'production-id' }],
      env: {
        preview: {
          assets: { directory: 'dist', run_worker_first: true },
          d1_databases: [{ migrations_dir: 'sql', database_id: 'preview-id' }],
        },
      },
    });
    expect(JSON.parse(await readFile(path.join(destination, 'wrangler.jsonc'), 'utf8'))).toEqual(
      generated,
    );
    await expect(
      generateTypedWorkerCompatibility(source, destination, {
        ...config,
        assetsDirectory: '../../../outside',
      }),
    ).rejects.toThrow('reviewed repository');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
