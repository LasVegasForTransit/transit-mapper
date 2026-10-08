import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { packageTypedWorkerRelease } from '../src/typed-worker-release-artifact.js';
import { verifyRelease } from '../src/saved-release-artifact.js';
test.each([true, false])(
  'typed packaging seals canonical settings and assets with HTML entry point=%s',
  async (htmlEntry) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'typed-worker-package-'));
    try {
      const source = path.join(root, 'apps/deploy');
      await mkdir(source, { recursive: true });
      await mkdir(path.join(root, 'apps/site/dist'), { recursive: true });
      await writeFile(
        path.join(root, 'apps/site/dist', htmlEntry ? 'index.html' : '0123456789abcdef'),
        '<main>Reviewed app</main>',
      );
      await writeFile(
        path.join(source, 'worker.mjs'),
        'export default {fetch(){return new Response("ok")}}',
      );
      const bindings = { ASSETS: { type: 'assets' }, TOKEN: { type: 'secret' } };
      const content = `export default ${JSON.stringify({ worker: { name: 'app', entrypoint: 'worker.mjs', compatibilityDate: '2026-08-31', domains: ['example.org'], observability: { enabled: true }, assets: { runWorkerFirst: true }, env: bindings } })}`;
      await writeFile(path.join(source, 'cloudflare.config.mjs'), content);
      await mkdir(path.join(root, 'bin'));
      const capture = path.join(root, 'dry-run.json');
      await writeFile(
        path.join(root, 'bin/pnpm'),
        String.raw`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),config=JSON.parse(fs.readFileSync(args[args.indexOf('--config')+1],'utf8'));
fs.writeFileSync(process.env.RELEASE_CAPTURE_PATH,JSON.stringify({args,config,entry:fs.readFileSync(config.main,'utf8')}));
fs.writeFileSync(path.join(args[args.indexOf('--outdir')+1],'index.js'),'export default {}');
`,
        { mode: 0o755 },
      );
      vi.stubEnv('PATH', `${path.join(root, 'bin')}:${process.env.PATH}`);
      vi.stubEnv('RELEASE_CAPTURE_PATH', capture);
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
        previewBindings: bindings,
        stagingWorkflow: {
          name: 'Deploy staging',
          path: '.github/workflows/deploy.yml',
          branch: 'main',
        },
        promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote app', branch: 'main' },
      };
      const directory = path.join(root, 'release');
      const release = await packageTypedWorkerRelease(
        source,
        directory,
        { commit: 'a'.repeat(40), releaseId: '123' },
        config,
      );
      const build = JSON.parse(await readFile(capture, 'utf8')) as {
        args: string[];
        entry: string;
        config: unknown;
      };
      expect(build.args).toEqual(
        expect.arrayContaining(['deploy', '--dry-run', '--config', '--outdir']),
      );
      expect(build.entry).toContain('X-Robots-Tag');
      expect(build.entry).toContain('export * from');
      expect(await verifyRelease(directory)).toEqual(release);
      expect(release.artifactKind).toBe(htmlEntry ? undefined : 'worker');
      await writeFile(
        path.join(directory, 'dist', htmlEntry ? 'index.html' : '0123456789abcdef'),
        'tampered',
      );
      await expect(verifyRelease(directory)).rejects.toThrow(/do not match/);
      expect(
        JSON.parse(
          await readFile(path.join(directory, '.wrangler/worker/config-source.json'), 'utf8'),
        ),
      ).toEqual({
        path: 'cloudflare.config.mjs',
        sha256: createHash('sha256').update(content).digest('hex'),
      });
      expect(
        JSON.parse(await readFile(path.join(directory, '.wrangler/worker/bindings.json'), 'utf8')),
      ).toEqual({ production: bindings, preview: bindings });
      await expect(
        packageTypedWorkerRelease(
          source,
          path.join(root, 'outside-release'),
          { commit: 'a'.repeat(40), releaseId: '123' },
          { ...config, assetsDirectory: '../../../' },
        ),
      ).rejects.toThrow('reviewed repository');
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  },
);
