import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ReleaseConfiguration } from './release-config.js';
import { readTypedWorkerConfiguration, reviewedReleasePath } from './typed-worker-input.js';

async function relocateConfiguration(
  source: string,
  destination: string,
  value: Record<string, unknown>,
  config: ReleaseConfiguration,
): Promise<Record<string, unknown>> {
  const result = { ...value };
  if (result.assets) {
    if (!config.assetsDirectory)
      throw new Error('Declare assetsDirectory for the canonical Worker assets.');
    const assets = await reviewedReleasePath(
      source,
      config.assetsDirectory,
      config.appDirectory,
      false,
    );
    result.assets = {
      ...z.record(z.string(), z.unknown()).parse(result.assets),
      directory: path.relative(destination, assets),
    };
  }
  const databases = z.array(z.record(z.string(), z.unknown())).parse(result.d1_databases ?? []);
  for (const migration of config.migrations ?? []) {
    const database = databases.find((entry) => entry.binding === migration.binding);
    if (!database)
      throw new Error(
        `Migration binding ${migration.binding} is absent from canonical configuration.`,
      );
    const directory = await reviewedReleasePath(
      source,
      migration.directory,
      config.appDirectory,
      false,
    );
    database.migrations_dir = path.relative(destination, directory);
  }
  if (databases.length) result.d1_databases = databases;
  return result;
}
export async function generateTypedWorkerCompatibility(
  source: string,
  destinationDirectory: string,
  config: ReleaseConfiguration,
): Promise<Record<string, unknown>> {
  const destination = await reviewedReleasePath(
    source,
    path.relative(source, destinationDirectory),
    config.appDirectory,
  );
  const { canonical, generated } = await readTypedWorkerConfiguration(source, config);
  const main = await reviewedReleasePath(
    source,
    path.relative(source, path.resolve(path.dirname(canonical), z.string().parse(generated.main))),
    config.appDirectory,
    false,
  );
  const production = await relocateConfiguration(source, destination, generated, config);
  const preview = z
    .object({ preview: z.record(z.string(), z.unknown()) })
    .parse(generated.env).preview;
  const result = {
    ...production,
    main: path.relative(destination, main),
    env: { preview: await relocateConfiguration(source, destination, preview, config) },
  };
  await writeFile(path.join(destination, 'wrangler.jsonc'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
