import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { activeVersion } from './cloudflare-release.js';
import type { ReleaseConfiguration } from './release-config.js';

type Run = (args: string[]) => Promise<string>;
const run: Run = async (args) =>
  (
    await promisify(execFile)('pnpm', args, {
      env: { ...process.env, WRANGLER_LOG_SANITIZE: 'true' },
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;

/** A read-only optimistic precondition, checked before every selected production write. */
export async function verifyExpectedProductionVersion(
  config: Pick<ReleaseConfiguration, 'productionWorker'>,
  expected: string | undefined,
  directory?: string,
  command: Run = run,
): Promise<void> {
  if (expected === undefined || expected === '') return;
  const version = z.uuid().parse(expected);
  const args = ['exec', 'wrangler', 'deployments', 'list', '--name', config.productionWorker];
  if (directory) args.push('--config', path.join(directory, 'wrangler.jsonc'), '--env', '');
  args.push('--json');
  const current = activeVersion(JSON.parse(await command(args)));
  if (current !== version)
    throw new Error(
      'The active production version changed; inspect the deployment before requesting promotion again. No production write was attempted.',
    );
}
