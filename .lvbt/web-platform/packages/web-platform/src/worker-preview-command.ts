import { verifyWorkerReleaseConfiguration } from './worker-release-configuration.js';
import type { ReleaseConfiguration } from './release-config.js';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

import { previewUploadReceipt } from './pr-preview-config.js';

const execute = promisify(execFile);

function workerSecrets(workerSecretNames: readonly string[]): Record<string, string> {
  const entries = workerSecretNames.map((name) => [name, process.env[name]?.trim()] as const);
  const missing = entries.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0)
    throw new Error(`Set the Worker candidate secrets: ${missing.join(', ')}.`);
  return Object.fromEntries(entries) as Record<string, string>;
}

export async function runWorkerPreview(
  config: ReleaseConfiguration,
  args: string[] = process.argv.slice(2),
  secretNames: readonly string[] = [],
): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      alias: { type: 'string' },
      message: { type: 'string' },
      env: { type: 'string' },
      secrets: { type: 'boolean', default: false },
    },
  });
  const alias = values.alias;
  if (!alias || !/^[a-z][a-z0-9-]*$/.test(alias))
    throw new Error('Pass a lowercase Worker preview alias with --alias.');
  // Pull request previews use the `preview` environment: a separate Worker bound to the preview
  // database. Without --env the version is uploaded to the production Worker.
  const environment = values.env;
  if (environment !== undefined && environment !== 'preview')
    throw new Error('The only Worker environment is --env preview.');
  const workerName = environment ? config.previewWorker : config.productionWorker;
  if (!config.workersDevSubdomain)
    throw new Error('Configure the reviewed workersDevSubdomain before uploading a preview.');

  await verifyWorkerReleaseConfiguration(process.cwd(), config);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lvbt-worker-preview-'));
  try {
    const receiptPath = path.join(directory, 'wrangler.jsonl');
    const secretsPath = path.join(directory, 'secrets.json');
    if (values.secrets)
      await writeFile(secretsPath, `${JSON.stringify(workerSecrets(secretNames))}\n`, {
        mode: 0o600,
      });
    await execute(
      'pnpm',
      [
        'exec',
        'wrangler',
        'versions',
        'upload',
        '--name',
        workerName,
        '--preview-alias',
        alias,
        '--message',
        values.message ?? `Website preview ${alias}`,
        ...(environment ? ['--env', environment] : []),
        ...(values.secrets ? ['--secrets-file', secretsPath] : []),
      ],
      {
        env: {
          ...process.env,
          WRANGLER_LOG_SANITIZE: 'true',
          WRANGLER_OUTPUT_FILE_PATH: receiptPath,
        },
        maxBuffer: 16 * 1024 * 1024,
      },
    );

    const receipt = previewUploadReceipt(
      await readFile(receiptPath, 'utf8'),
      workerName,
      config.workersDevSubdomain,
    );
    const output = process.env.GITHUB_OUTPUT;
    if (output)
      await writeFile(output, `url=${receipt.url}\nversion=${receipt.version}\n`, { flag: 'a' });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
