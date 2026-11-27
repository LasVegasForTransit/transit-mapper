import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'jsonc-parser';
import { z } from 'zod';
import { accessFetch, accessCredentials } from './access-auth.js';
import type { ReleaseConfiguration } from './release-config.js';
import { waitForReleaseIdentity } from './release-identity.js';
import { verifyRelease, type WebsiteRelease } from './saved-release-artifact.js';
const execute = promisify(execFile);
export function namedDeployReceipt(output: string, worker: string): { version: string } {
  const schema = z.object({
    type: z.literal('deploy'),
    version: z.literal(1),
    worker_name: z.literal(worker),
    version_id: z.uuid(),
  });
  const records = output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => schema.safeParse(JSON.parse(line) as unknown))
    .filter((result) => result.success);
  if (records.length !== 1 || !records[0]?.success)
    throw new Error(
      'Expected one matching named Worker deployment receipt; reconcile provider state before retrying.',
    );
  return { version: records[0].data.version_id };
}
export async function deployNamedSavedRelease(
  config: ReleaseConfiguration,
  directory: string,
  release: WebsiteRelease,
  target: 'preview' | 'production',
): Promise<{ version: string }> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-named-release-'));
  try {
    const copy = path.join(temporary, 'release');
    await cp(directory, copy, { recursive: true });
    if ((await verifyRelease(copy)).artifactHash !== release.artifactHash)
      throw new Error('Saved release changed while preparing deployment.');
    const configPath = path.join(copy, 'wrangler.jsonc');
    const workerConfig = parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    const withoutConfiguredRoutes = (worker: Record<string, unknown>) => {
      if (!Array.isArray(worker.routes) || worker.routes.length > 0) delete worker.routes;
      delete worker.route;
    };
    withoutConfiguredRoutes(workerConfig);
    if (workerConfig.env && typeof workerConfig.env === 'object')
      for (const environment of Object.values(workerConfig.env))
        if (environment && typeof environment === 'object')
          withoutConfiguredRoutes(environment as Record<string, unknown>);
    await writeFile(configPath, `${JSON.stringify(workerConfig, null, 2)}\n`);
    const receiptPath = path.join(temporary, 'receipt.jsonl');
    const worker = target === 'preview' ? config.previewWorker : config.productionWorker;
    await execute(
      'pnpm',
      [
        'exec',
        'wrangler',
        'deploy',
        '--name',
        worker,
        '--config',
        path.join(copy, 'wrangler.jsonc'),
        '--env',
        target === 'preview' ? 'preview' : '',
        '--no-bundle',
      ],
      {
        env: {
          ...process.env,
          CI: 'true',
          WRANGLER_LOG_SANITIZE: 'true',
          WRANGLER_OUTPUT_FILE_PATH: receiptPath,
        },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return namedDeployReceipt(await readFile(receiptPath, 'utf8'), worker);
  } catch (cause) {
    throw new Error(
      'Named Worker deployment outcome is unknown; reconcile the selected Worker and live release marker before retrying or promoting.',
      { cause },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
function assertNamedPreviewOrigin(config: ReleaseConfiguration): void {
  const origin = new URL(config.previewUrl);
  if (
    origin.hostname.endsWith('.workers.dev') &&
    origin.hostname !== `${config.previewWorker}.${config.workersDevSubdomain}.workers.dev`
  )
    throw new Error(
      'Named staging origin does not identify the reviewed Worker and workers.dev account.',
    );
}
export async function assertNamedPreviewProtection(config: ReleaseConfiguration): Promise<void> {
  assertNamedPreviewOrigin(config);
  const anonymous = await accessFetch(config.previewUrl, config.previewUrl);
  if (![302, 401, 403].includes(anonymous.status))
    throw new Error('Named staging requires Access anonymous denial before deploying saved bytes.');
  await anonymous.arrayBuffer();
}
export async function verifyNamedPreview(
  config: ReleaseConfiguration,
  release: WebsiteRelease,
): Promise<void> {
  assertNamedPreviewOrigin(config);
  const credentials = accessCredentials(process.env);
  if (!credentials) throw new Error('Named staging verification requires Access credentials.');
  await waitForReleaseIdentity(
    config.previewUrl,
    {
      commit: release.commit,
      releaseId: release.releaseId,
      ...(release.app ? { app: release.app } : {}),
    },
    { credentials },
  );
}
