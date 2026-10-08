import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { formatJson } from './astro-sync.ts';
import { readOptional, rejectSymlinkDestination } from './paths.ts';
import type { WebPreset } from './web-platform.ts';
import type * as CacheModule from '../packages/cli/src/lib/check/turbo-cache.mjs';
import { incomingPolicy } from './incoming-policy.ts';

type CachePolicy = typeof CacheModule;

/** Add shared cache inputs without owning application tasks or removing existing root inputs. */
export async function syncTurboCache(
  root: string,
  bundle: WebPreset,
  dryRun: boolean,
): Promise<string[]> {
  await rejectSymlinkDestination(root, 'turbo.json');
  const file = path.join(root, 'turbo.json');
  const source = await readOptional(file);
  if (source === null) return [];
  const { TURBO_GLOBAL_DEPENDENCIES, parseTurboCache } = await incomingPolicy<CachePolicy>(
    bundle,
    'packages/cli/src/lib/check/turbo-cache.mjs',
    () => import('../packages/cli/src/lib/check/turbo-cache.mjs'),
  );
  const config = parseTurboCache(source);
  const globals = config.globalDependencies ?? [];
  const added = TURBO_GLOBAL_DEPENDENCIES.filter((entry) => !globals.includes(entry));
  if (!added.length) return [];
  if (!dryRun)
    await writeFile(
      file,
      `${formatJson({ ...config, globalDependencies: [...globals, ...added] })}\n`,
    );
  return ['turbo.json'];
}
