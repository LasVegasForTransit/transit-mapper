import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WebPreset } from './web-platform.ts';

const vendorCli = 'packages/cli/src/cli.mjs';
/** Normalize only shared setup entrypoints; retain every application command and registry setting. */
export async function syncSetupEntrypoints(
  root: string,
  bundle: Pick<WebPreset, 'files'>,
  dryRun = false,
): Promise<string[]> {
  const manifestPath = path.join(root, 'package.json');
  if (!bundle.files[vendorCli] || !existsSync(manifestPath)) return [];
  const source = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(source) as { scripts?: Record<string, string> };
  manifest.scripts ??= {};
  const prefix = 'node .lvbt/web-platform/packages/cli/src/cli.mjs';
  let manifestChanged = false;
  for (const command of ['bootstrap', 'preflight']) {
    const wanted = `${prefix} ${command}`;
    if (manifest.scripts[command] !== wanted) manifestChanged = true;
    manifest.scripts[command] = wanted;
  }
  const workspacePath = path.join(root, 'pnpm-workspace.yaml');
  const workspace = existsSync(workspacePath) ? await readFile(workspacePath, 'utf8') : '';
  const next = setupWorkspace(workspace);
  const changed = [
    ...(manifestChanged ? ['package.json'] : []),
    ...(next !== workspace ? ['pnpm-workspace.yaml'] : []),
  ];
  if (!dryRun) {
    if (manifestChanged) await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    if (next !== workspace) await writeFile(workspacePath, next);
  }
  return changed;
}

function setupWorkspace(workspace: string): string {
  const key = /^(?:verifyDepsBeforeRun|'verifyDepsBeforeRun'|"verifyDepsBeforeRun")\s*:.*$/gmu;
  const matches = [...workspace.matchAll(key)];
  if (matches.length > 1)
    throw new Error('Duplicate verifyDepsBeforeRun workspace settings need review.');
  return matches.length
    ? workspace.replace(
        key,
        `verifyDepsBeforeRun: false${matches[0]?.[0].match(/\s+#.*$/u)?.[0] ?? ''}`,
      )
    : `${workspace}${workspace && !workspace.endsWith('\n') ? '\n' : ''}\n# Shared setup validates before installing; preflight never installs.\nverifyDepsBeforeRun: false\n`;
}
