import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { ReleaseConfiguration } from './release-config.js';
import { packageRelease, sealSavedRelease, type WebsiteRelease } from './saved-release-artifact.js';
import { configuredReleaseIdentity, workerReleaseEntry } from './worker-release-entry.js';
import { readTypedWorkerConfiguration, reviewedReleasePath } from './typed-worker-input.js';
import type { ArtifactAcceptance } from './saved-release-artifact.js';
import { retainReleaseMigrations } from './saved-release-migrations.js';
import { verifyReadOnlyWorkerModules } from './read-only-worker-modules.js';
const execute = promisify(execFile);

async function retainedConfiguration(
  generated: Record<string, unknown>,
  temporary: string,
  assets: string | undefined,
): Promise<void> {
  const preview = z
    .object({ preview: z.record(z.string(), z.unknown()) })
    .parse(generated.env).preview;
  const assetSettings = assets
    ? { ...z.record(z.string(), z.unknown()).parse(generated.assets), directory: './dist' }
    : undefined;
  await writeFile(
    path.join(temporary, 'wrangler.jsonc'),
    JSON.stringify(
      {
        ...generated,
        main: '.wrangler/worker/index.js',
        assets: assetSettings,
        env: {
          preview: {
            ...preview,
            assets: assets
              ? {
                  ...z.record(z.string(), z.unknown()).parse(preview.assets),
                  directory: assetSettings?.directory,
                }
              : undefined,
          },
        },
      },
      null,
      2,
    ),
  );
}
async function sealTypedBuild(
  temporary: string,
  destination: string,
  input: {
    identity: { commit: string; releaseId: string };
    assets: string | undefined;
    acceptance: ArtifactAcceptance | undefined;
  },
): Promise<WebsiteRelease> {
  if (input.assets) {
    await cp(input.assets, path.join(temporary, 'dist'), { recursive: true });
    return await packageRelease(temporary, destination, input.identity, {
      ...input.acceptance,
      formatVersion: 2,
      ...(!(await readdir(input.assets)).includes('index.html')
        ? { artifactKind: 'worker' as const }
        : {}),
    });
  }
  await mkdir(destination);
  await cp(path.join(temporary, '.wrangler'), path.join(destination, '.wrangler'), {
    recursive: true,
  });
  await cp(path.join(temporary, 'wrangler.jsonc'), path.join(destination, 'wrangler.jsonc'));
  await writeFile(path.join(destination, 'lvbt-release.json'), JSON.stringify(input.identity));
  return await sealSavedRelease(destination, input.identity, 'worker', 2);
}
async function retainSourceDeclarations(
  temporary: string,
  imported: unknown,
  input: { canonical: string; config: ReleaseConfiguration },
): Promise<void> {
  await writeFile(
    path.join(temporary, '.wrangler/worker/preview-capabilities.json'),
    JSON.stringify({ readOnlyBindings: input.config.previewReadOnlyBindings ?? [] }),
  );
  await writeFile(
    path.join(temporary, '.wrangler/worker/config-source.json'),
    JSON.stringify({
      path: input.config.typedConfig,
      sha256: createHash('sha256')
        .update(await readFile(input.canonical))
        .digest('hex'),
    }),
  );
  const production = z
    .object({ worker: z.object({ env: z.record(z.string(), z.unknown()) }) })
    .parse(imported).worker.env;
  await writeFile(
    path.join(temporary, '.wrangler/worker/bindings.json'),
    JSON.stringify({ production, preview: input.config.previewBindings }, null, 2),
  );
}
function typedEntry(
  main: string,
  identity: { commit: string; releaseId: string },
  generated: Record<string, unknown>,
  config: ReleaseConfiguration,
): string {
  return workerReleaseEntry(main, identity, {
    ...config,
    durableExports: Object.keys(z.record(z.string(), z.unknown()).parse(generated.exports ?? {})),
  });
}
export async function packageTypedWorkerRelease(
  source: string,
  destination: string,
  identity: { commit: string; releaseId: string },
  config: ReleaseConfiguration,
): Promise<WebsiteRelease> {
  identity = configuredReleaseIdentity(identity, config);
  const { canonical, imported, generated } = await readTypedWorkerConfiguration(source, config);
  const main = await reviewedReleasePath(
    source,
    path.relative(source, path.resolve(path.dirname(canonical), z.string().parse(generated.main))),
    config.appDirectory,
  );
  const assets = config.assetsDirectory
    ? await reviewedReleasePath(source, config.assetsDirectory, config.appDirectory)
    : undefined;
  if (Boolean(generated.assets) !== Boolean(assets))
    throw new Error('Declare assetsDirectory for the canonical Worker assets.');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-typed-worker-'));
  try {
    await mkdir(path.join(temporary, '.wrangler/worker'), { recursive: true });
    await writeFile(
      path.join(temporary, 'index.ts'),
      typedEntry(main, identity, generated, config),
    );
    const assetSettings = assets
      ? { ...z.record(z.string(), z.unknown()).parse(generated.assets), directory: assets }
      : undefined;
    const buildConfig = path.join(temporary, 'build.json');
    const preview = z
      .object({ preview: z.record(z.string(), z.unknown()) })
      .parse(generated.env).preview;
    await writeFile(
      buildConfig,
      JSON.stringify({
        ...generated,
        main: path.join(temporary, 'index.ts'),
        assets: assetSettings,
        env: {
          preview: {
            ...preview,
            assets: assets
              ? {
                  ...z.record(z.string(), z.unknown()).parse(preview.assets),
                  directory: assetSettings?.directory,
                }
              : undefined,
          },
        },
      }),
    );
    await execute(
      'pnpm',
      [
        'exec',
        'wrangler',
        'deploy',
        '--dry-run',
        '--config',
        buildConfig,
        '--outdir',
        path.join(temporary, '.wrangler/worker'),
      ],
      { cwd: source, maxBuffer: 16 * 1024 * 1024 },
    );
    await retainedConfiguration(generated, temporary, assets);
    await retainSourceDeclarations(temporary, imported, { canonical, config });
    if (config.previewReadOnlyBindings?.length) await verifyReadOnlyWorkerModules(temporary);
    if (config.migrations?.length) await retainReleaseMigrations(source, temporary, config);
    return await sealTypedBuild(temporary, destination, {
      identity,
      assets,
      acceptance: config.artifactAcceptance,
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
