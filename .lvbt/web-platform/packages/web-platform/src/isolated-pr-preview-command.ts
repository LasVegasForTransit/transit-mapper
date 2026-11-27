import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { z } from 'zod';
import type { ReleaseConfiguration } from './release-config.js';
import { assertPreviewBuild, preparePreviewUpload } from './isolated-pr-preview.js';
import { packageTypedWorkerRelease } from './typed-worker-release-artifact.js';
import { readTypedWorkerConfiguration } from './typed-worker-input.js';
import { previewUploadReceipt } from './pr-preview-config.js';

const execute = promisify(execFile);
async function github(endpoint: string): Promise<unknown> {
  return JSON.parse((await execute('gh', ['api', endpoint])).stdout) as unknown;
}
async function output(value: Record<string, string | number | undefined>): Promise<void> {
  if (process.env.GITHUB_OUTPUT)
    await writeFile(
      process.env.GITHUB_OUTPUT,
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => `${key}=${item}\n`)
        .join(''),
      { flag: 'a' },
    );
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
async function source(config: ReleaseConfiguration, workflow: string) {
  if (
    process.env.GITHUB_EVENT_NAME !== 'workflow_run' ||
    process.env.GITHUB_REPOSITORY !== config.repository ||
    process.env.GITHUB_REF !== `refs/heads/${config.promotionWorkflow.branch}`
  )
    throw new Error('Preview publication requires a trusted default-branch workflow_run.');
  const event = z
    .object({ workflow_run: z.object({ id: z.number().int().positive() }) })
    .parse(JSON.parse(await readFile(z.string().parse(process.env.GITHUB_EVENT_PATH), 'utf8')));
  const id = String(event.workflow_run.id);
  const run = await github(`repos/${config.repository}/actions/runs/${id}`);
  const commit = z.object({ head_sha: z.string().regex(/^[a-f0-9]{40}$/) }).parse(run).head_sha;
  // GitHub may omit run.pull_requests; resolve the still-open PR through its authenticated commit association.
  const associations = z
    .array(z.object({ number: z.number().int().positive() }))
    .parse(await github(`repos/${config.repository}/commits/${commit}/pulls`));
  const matches = [];
  for (const pr of associations) {
    const detail = await github(`repos/${config.repository}/pulls/${pr.number}`);
    try {
      matches.push(
        assertPreviewBuild(
          run,
          detail,
          { repository: config.repository, workflow, branch: config.promotionWorkflow.branch },
          id,
        ),
      );
    } catch {
      /* An association may refer to a closed, stale or differently targeted PR. */
    }
  }
  if (matches.length !== 1 || !matches[0])
    throw new Error('Expected one current, successful same-repository PR build.');
  const artifact = `${config.artifactPrefix}-pr-${id}`;
  const listed = z
    .object({
      artifacts: z.array(z.object({ id: z.number(), name: z.string(), expired: z.boolean() })),
    })
    .parse(await github(`repos/${config.repository}/actions/runs/${id}/artifacts?per_page=100`))
    .artifacts.filter((item) => item.name === artifact && !item.expired);
  if (listed.length !== 1)
    throw new Error('Expected one retained PR payload from the validated run.');
  return { ...matches[0], artifact, ...(config.profile ? { app: config.profile } : {}) };
}
export async function runIsolatedPrPreview(
  config: ReleaseConfiguration,
  args: string[],
): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      action: { type: 'string' },
      directory: { type: 'string' },
      workflow: { type: 'string' },
    },
  });
  assertIsolatedConfiguration(config);
  if (values.action === 'build') {
    await buildPayload(config, values.directory);
    return;
  }
  const selected = await source(
    config,
    z
      .string()
      .regex(/^\.github\/workflows\/[a-z0-9-]+\.yml$/)
      .parse(values.workflow),
  );
  if (values.action === 'source') {
    await output(selected);
    return;
  }
  if (values.action !== 'publish') throw new Error('Use build, source or publish.');
  if (!config.workersDevSubdomain) throw new Error('Configure the trusted Workers subdomain.');
  const { generated } = await readTypedWorkerConfiguration(process.cwd(), config);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-isolated-preview-'));
  try {
    const directory = path.join(temporary, 'upload');
    await preparePreviewUpload(z.string().parse(values.directory), directory, generated, {
      identity: selected,
      worker: config.previewWorker,
    });
    const receiptPath = path.join(temporary, 'receipt.jsonl');
    await execute(
      'pnpm',
      [
        'exec',
        'wrangler',
        'versions',
        'upload',
        '--name',
        config.previewWorker,
        '--config',
        path.join(directory, 'wrangler.jsonc'),
        '--no-bundle',
        '--preview-alias',
        `pr-${selected.number}`,
        '--message',
        `PR #${selected.number} at ${selected.commit}`,
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
      config.previewWorker,
      config.workersDevSubdomain,
    );
    await output({ ...receipt, number: selected.number, commit: selected.commit });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function buildPayload(
  config: ReleaseConfiguration,
  directory: string | undefined,
): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request')
    throw new Error('PR payloads require a pull_request build.');
  const event = z
    .object({
      pull_request: z.object({ head: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }) }),
    })
    .parse(JSON.parse(await readFile(z.string().parse(process.env.GITHUB_EVENT_PATH), 'utf8')));
  await packageTypedWorkerRelease(
    process.cwd(),
    z.string().parse(directory),
    {
      commit: event.pull_request.head.sha,
      releaseId: z.string().regex(/^\d+$/).parse(process.env.GITHUB_RUN_ID),
    },
    { ...config, artifactAcceptance: undefined },
  );
}

function assertIsolatedConfiguration(config: ReleaseConfiguration): void {
  if (
    config.artifactSource !== 'typed-worker' ||
    (config.publicationMode ?? 'version') !== 'version'
  )
    throw new Error('Isolated PR previews currently require typed Worker version uploads.');
  if (config.previewReadOnlyBindings?.length)
    throw new Error(
      'Isolated PR previews require separate preview resources; PR read-only facades are untrusted.',
    );
}
