import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { ReleaseConfiguration } from './release-config.js';
import { resolveTypedConfiguration, typedWorkerConfiguration } from './typed-worker-config.js';

function repositoryRoot(source: string, appDirectory: string): string {
  return path.resolve(
    source,
    ...path
      .normalize(appDirectory)
      .split(path.sep)
      .filter((segment) => segment !== '.')
      .map(() => '..'),
  );
}
async function existingAncestor(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch (error) {
    if (!z.object({ code: z.literal('ENOENT') }).safeParse(error).success) throw error;
    return await existingAncestor(path.dirname(file));
  }
}
export async function reviewedReleasePath(
  source: string,
  relative: string,
  appDirectory: string,
  requireExists = true,
): Promise<string> {
  const root = repositoryRoot(source, appDirectory);
  const canonicalRoot = await realpath(root);
  const file = path.resolve(source, relative);
  const canonical = requireExists ? await realpath(file) : await existingAncestor(file);
  const contained = (value: string): boolean =>
    value === root || value.startsWith(`${root}${path.sep}`);
  if (
    !contained(file) ||
    !(canonical === canonicalRoot || canonical.startsWith(`${canonicalRoot}${path.sep}`))
  )
    throw new Error('Canonical release inputs must stay inside the reviewed repository.');
  if (requireExists && (await lstat(file)).isSymbolicLink())
    throw new Error('Canonical release inputs must stay inside the reviewed repository.');
  return file;
}
export async function readTypedWorkerConfiguration(
  source: string,
  config: ReleaseConfiguration,
): Promise<{ canonical: string; imported: unknown; generated: Record<string, unknown> }> {
  if (!config.typedConfig) throw new Error('Declare the canonical typedConfig before packaging.');
  const canonical = await reviewedReleasePath(source, config.typedConfig, config.appDirectory);
  const input: unknown = await z
    .object({ default: z.unknown() })
    .parse(await import(pathToFileURL(canonical).href)).default;
  const imported = await resolveTypedConfiguration(input);
  const preview =
    typeof input === 'function' ? await resolveTypedConfiguration(input, true) : undefined;
  return { canonical, imported, generated: typedWorkerConfiguration(imported, config, preview) };
}
