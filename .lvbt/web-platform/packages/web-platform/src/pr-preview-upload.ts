import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { activeVersion, uploadedVersion } from './cloudflare-release.js';
import type { CloudflareRead } from './doctor-cloudflare.js';
import { previewUploadReceipt, previewConfiguration } from './pr-preview-config.js';

interface Target {
  directory: string;
  worker: string;
  mode: 'version' | 'temporary';
  repository: string;
  pullRequest: number;
  commit: string;
  accountId: string;
}
const execute = promisify(execFile);
async function runWrangler(args: string[], output: string, accountId: string) {
  try {
    await execute('pnpm', ['exec', 'wrangler', ...args], {
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        WRANGLER_OUTPUT_FILE_PATH: output,
        WRANGLER_LOG_SANITIZE: 'true',
      },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    throw new Error(
      'Preview upload unconfirmed. Inspect its receipt and provider state before retrying.',
    );
  }
}

function temporaryReceipt(output: string, worker: string) {
  const version = uploadedVersion(output, worker);
  const schema = z.object({
    type: z.literal('deploy'),
    worker_name: z.literal(worker),
    targets: z.array(z.string()),
  });
  const urls = output
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      const result = schema.safeParse(JSON.parse(line));
      return result.success ? result.data.targets : [];
    });
  const url = urls.find((candidate) => {
    try {
      const value = new URL(candidate);
      return (
        value.protocol === 'https:' &&
        value.hostname.startsWith(`${worker}.`) &&
        value.hostname.endsWith('.workers.dev') &&
        !value.username &&
        !value.password &&
        !value.port &&
        value.pathname === '/' &&
        !value.search &&
        !value.hash
      );
    } catch {
      return false;
    }
  });
  if (!url) throw new Error('Temporary preview URL is missing from the deployment receipt.');
  return { version, url };
}

async function validateConfiguration(target: Target) {
  z.string()
    .regex(/^[a-z0-9-]{1,63}$/)
    .parse(target.worker);
  z.string()
    .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/)
    .parse(target.repository);
  z.number().int().positive().parse(target.pullRequest);
  z.string()
    .regex(/^[a-f0-9]{40}$/)
    .parse(target.commit);
  const configPath = path.join(target.directory, 'wrangler.json');
  const config: unknown = JSON.parse(await readFile(configPath, 'utf8'));
  const settings = z
    .object({
      name: z.literal(target.worker),
      assets: z.object({ directory: z.string() }),
      routes: z.array(z.unknown()).length(0),
      account_id: z.string().optional(),
      vars: z.unknown().optional(),
      workers_dev: z.boolean(),
      preview_urls: z.boolean(),
    })
    .parse(config);
  previewConfiguration(config, target.worker, settings.assets.directory, target.mode);
  if (
    (settings.account_id !== undefined && settings.account_id !== target.accountId) ||
    settings.vars !== undefined ||
    settings.workers_dev !== (target.mode === 'temporary') ||
    !settings.preview_urls
  )
    throw new Error('Preview configuration does not match the isolated target.');
  return configPath;
}

export async function uploadPreview(
  target: Target,
  read: CloudflareRead,
  run: (args: string[], output: string, accountId: string) => Promise<void> = runWrangler,
) {
  const configPath = await validateConfiguration(target);
  const base = `accounts/${target.accountId}/workers/scripts`;
  const workers = z.array(z.object({ id: z.string() })).parse(await read.list(base));
  const exists = workers.some((worker) => worker.id === target.worker);
  const current = async () =>
    activeVersion(
      z
        .object({ deployments: z.unknown() })
        .parse(await read.get(`${base}/${target.worker}/deployments`)).deployments,
    );
  const previousVersion = exists ? await current() : null;
  if (target.mode === 'version' && previousVersion === null)
    throw new Error('Version previews require an existing production deployment.');
  const owner = `LVBT preview ${target.repository}#${target.pullRequest} `;
  if (previousVersion) {
    const version = z
      .object({
        annotations: z.record(z.string(), z.string()).optional(),
        resources: z.object({ bindings: z.array(z.object({ type: z.literal('assets') })).max(1) }),
      })
      .parse(await read.get(`${base}/${target.worker}/versions/${previousVersion}`));
    if (target.mode === 'temporary' && !version.annotations?.['workers/message']?.startsWith(owner))
      throw new Error('Existing temporary Worker has no matching preview ownership.');
  }
  const output = path.join(target.directory, `upload-${randomUUID()}.jsonl`);
  await run(
    [
      ...(target.mode === 'version' ? ['versions', 'upload'] : ['deploy']),
      '--config',
      configPath,
      '--strict',
      '--message',
      `${owner}${target.commit}`,
    ],
    output,
    target.accountId,
  );
  const contents = await readFile(output, 'utf8');
  const receipt =
    target.mode === 'version'
      ? previewUploadReceipt(contents, target.worker)
      : temporaryReceipt(contents, target.worker);
  if (target.mode === 'version' && (await current()) !== previousVersion)
    throw new Error('The production deployment changed during preview upload.');
  return { ...receipt, previousVersion };
}
