import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { incomingPolicy } from './incoming-policy.ts';
import { readOptional, rejectSymlinkDestination } from './paths.ts';
import type { WebPreset } from './web-platform.ts';
import type * as WorkspaceModule from '../packages/cli/src/lib/check/workspace-policy.mjs';

/** The incoming audited map owns shared selectors; application overrides remain product-owned. */
export async function syncWorkspaceOverrides(
  root: string,
  bundle: WebPreset,
  dryRun: boolean,
): Promise<string[]> {
  const catalog = bundle.files['packages/cli/catalog.json'];
  if (catalog === undefined) return [];
  const { overrides } = JSON.parse(catalog) as { overrides?: Record<string, string> };
  if (overrides === undefined) return [];
  await rejectSymlinkDestination(root, 'pnpm-workspace.yaml');
  const file = path.join(root, 'pnpm-workspace.yaml');
  const source = await readOptional(file);
  if (source === null)
    throw new Error('pnpm-workspace.yaml is missing; cannot apply shared audited overrides.');
  const { updateOverrides } = await incomingPolicy<typeof WorkspaceModule>(
    bundle,
    'packages/cli/src/lib/check/workspace-policy.mjs',
    () => import('../packages/cli/src/lib/check/workspace-policy.mjs'),
  );
  const next = updateOverrides(source, overrides);
  if (next === source) return [];
  if (!dryRun) await writeFile(file, next);
  return ['pnpm-workspace.yaml'];
}
