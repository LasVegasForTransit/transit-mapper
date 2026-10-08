import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { ReleaseConfiguration } from './release-config.js';
import { configuredReleaseIdentity, workerReleaseEntry } from './worker-release-entry.js';
import { packageWorkerCfRelease } from './cf-worker-release-artifact.js';
import { packageRelease, type WebsiteRelease } from './saved-release-artifact.js';
import { releaseMarkerAssets } from './release-marker-assets.js';

const staticWorker = z.strictObject({
  name: z.string(),
  compatibilityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  compatibilityFlags: z.array(z.string()).optional(),
  assets: z.strictObject({
    notFoundHandling: z.enum(['none', '404-page', 'single-page-application']).optional(),
    htmlHandling: z
      .enum(['auto-trailing-slash', 'force-trailing-slash', 'drop-trailing-slash', 'none'])
      .optional(),
  }),
  observability: z.unknown().optional(),
  previewUrls: z.boolean().optional(),
  workersDev: z.boolean().optional(),
});
const assetWorker = 'export default {fetch(request,env){return env.ASSETS.fetch(request)}};\n';

export async function packageCfRelease(
  source: string,
  destination: string,
  identity: { commit: string; releaseId: string },
  config: ReleaseConfiguration,
): Promise<WebsiteRelease> {
  identity = configuredReleaseIdentity(identity, config);
  const worker = path.join(source, '.cloudflare/output/v0/workers/default');
  const descriptor = path.join(worker, 'worker.config.json');
  if ((await lstat(descriptor)).isSymbolicLink()) throw new Error('Invalid cf Worker descriptor.');
  const value: unknown = JSON.parse(await readFile(descriptor, 'utf8'));
  if (z.object({ manifest: z.unknown() }).safeParse(value).success)
    return await packageWorkerCfRelease(source, destination, identity, config);
  const built = staticWorker.parse(value);
  if (built.name !== config.productionWorker)
    throw new Error('The built Worker does not match the configured production Worker.');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-cf-release-'));
  try {
    await cp(path.join(worker, 'assets'), path.join(temporary, 'dist'), { recursive: true });
    await mkdir(path.join(temporary, '.wrangler/worker'), { recursive: true });
    await writeFile(path.join(temporary, '.wrangler/worker/assets.js'), assetWorker);
    await writeFile(
      path.join(temporary, '.wrangler/worker/index.js'),
      workerReleaseEntry('./assets.js', identity, config),
    );
    const assets = releaseMarkerAssets(
      {
        directory: './dist',
        binding: 'ASSETS',
        run_worker_first: true,
        not_found_handling: built.assets.notFoundHandling ?? 'none',
        ...(built.assets.htmlHandling ? { html_handling: built.assets.htmlHandling } : {}),
      },
      config.publicPath,
    );
    await writeFile(
      path.join(temporary, 'wrangler.jsonc'),
      JSON.stringify(
        {
          name: config.productionWorker,
          main: '.wrangler/worker/index.js',
          compatibility_date: built.compatibilityDate,
          compatibility_flags: built.compatibilityFlags ?? [],
          assets,
          observability: built.observability ?? { enabled: true },
          workers_dev: false,
          preview_urls: true,
          routes: [{ pattern: new URL(config.productionUrl).hostname, custom_domain: true }],
          vars: { LVBT_DEPLOYMENT_ENV: 'production' },
          env: {
            preview: {
              name: config.previewWorker,
              assets,
              routes: [{ pattern: new URL(config.previewUrl).hostname, custom_domain: true }],
              vars: { LVBT_DEPLOYMENT_ENV: 'preview' },
            },
          },
        },
        null,
        2,
      ),
    );
    return await packageRelease(temporary, destination, identity, {
      ...config.artifactAcceptance,
      formatVersion: 2,
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
