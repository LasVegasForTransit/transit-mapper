import { constants } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { z } from 'zod';
import { releaseMarkerAssets } from './release-marker-assets.js';
import { workerReleaseEntry } from './worker-release-entry.js';
import type { ReleaseConfiguration } from './release-config.js';
import type { SavedReleaseIdentity } from './saved-release-artifact.js';
const record = z.record(z.string(), z.unknown());
function fields(value: unknown): Record<string, unknown> {
  return record.parse(value ?? {});
}
export async function normalizeLegacyReleaseMarker(
  directory: string,
  identity: SavedReleaseIdentity,
  config: ReleaseConfiguration,
): Promise<void> {
  const file = path.join(directory, 'wrangler.jsonc');
  const errors: ParseError[] = [];
  const settings = fields(
    parse(await readFile(file, 'utf8'), errors, { allowTrailingComma: true }),
  );
  if (errors.length) throw new Error('Invalid legacy Worker configuration.');
  const environments = fields(settings.env);
  const preview = fields(environments.preview);
  const assets = settings.assets
    ? releaseMarkerAssets(fields(settings.assets), config.publicPath)
    : undefined;
  const previewAssets = preview.assets
    ? releaseMarkerAssets(fields(preview.assets), config.publicPath)
    : assets;
  const worker = path.join(directory, '.wrangler/worker');
  await copyFile(
    path.join(worker, 'index.js'),
    path.join(worker, 'release-original.js'),
    constants.COPYFILE_EXCL,
  );
  await writeFile(
    path.join(worker, 'index.js'),
    workerReleaseEntry('./release-original.js', identity, config),
  );
  await writeFile(
    file,
    JSON.stringify(
      {
        ...settings,
        main: '.wrangler/worker/index.js',
        assets,
        vars: { ...fields(settings.vars), LVBT_DEPLOYMENT_ENV: 'production' },
        env: {
          ...environments,
          preview: {
            ...preview,
            assets: previewAssets,
            vars: { ...fields(preview.vars), LVBT_DEPLOYMENT_ENV: 'preview' },
          },
        },
      },
      null,
      2,
    ),
  );
}
