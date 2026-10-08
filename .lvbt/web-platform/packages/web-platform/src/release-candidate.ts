import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import { z } from 'zod';
import { githubJson } from './release-github.js';
import type { ReleaseConfiguration } from './release-config.js';
import type { WebsiteRelease } from './saved-release-artifact.js';
const execute = promisify(execFile);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const identifier = z.string().regex(/^[1-9][0-9]*$/);
export const candidateReceiptSchema = z.strictObject({
  formatVersion: z.literal(1),
  issuer: z.strictObject({
    runId: identifier,
    attempt: identifier,
    toolsCommit: sha,
    sharedCommit: sha,
  }),
  release: z.strictObject({
    commit: sha,
    releaseId: identifier,
    artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
    app: z.string().optional(),
  }),
  preview: z.strictObject({ worker: z.string(), origin: z.url(), version: z.uuid() }),
  checks: z.strictObject({
    artifact: z.literal('success'),
    smoke: z.literal('success'),
    browser: z.enum(['success', 'not-applicable']),
  }),
});
type CandidateReceipt = z.infer<typeof candidateReceiptSchema>;
interface CandidateContext {
  runId: string;
  attempt: string;
  toolsCommit: string;
  sharedCommit: string;
}
export interface CandidateOperations {
  getRun(id: string): Promise<unknown>;
  getJobs(id: string): Promise<unknown>;
  getArtifacts(id: string): Promise<unknown>;
  downloadArtifact(id: number): Promise<string>;
}
export function candidateArtifactName(
  context: Pick<CandidateContext, 'runId' | 'attempt'>,
  profile?: string,
): string {
  return `candidate-${context.runId}-${context.attempt}${profile ? `-${profile}` : ''}`;
}
async function currentContext(config: ReleaseConfiguration): Promise<CandidateContext> {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_REPOSITORY !== config.repository ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
  )
    throw new Error(
      'Trusted candidate receipts require the current default-branch manual promotion run.',
    );
  const root = path.resolve(
    process.cwd(),
    ...config.appDirectory
      .split('/')
      .filter((part) => part !== '.')
      .map(() => '..'),
  );
  const shared = z
    .object({ commit: sha })
    .parse(JSON.parse(await readFile(path.join(root, '.lvbt/web-platform.json'), 'utf8')));
  return {
    runId: identifier.parse(process.env.GITHUB_RUN_ID),
    attempt: identifier.parse(process.env.GITHUB_RUN_ATTEMPT),
    toolsCommit: sha.parse(process.env.GITHUB_SHA),
    sharedCommit: shared.commit,
  };
}
function selectedRelease(release: WebsiteRelease) {
  return {
    commit: release.commit,
    releaseId: release.releaseId,
    artifactHash: release.artifactHash,
    ...(release.app ? { app: release.app } : {}),
  };
}
export async function createCandidateReceipt(
  config: ReleaseConfiguration,
  release: WebsiteRelease,
  input: { directory: string; version: string; browser: string },
): Promise<void> {
  if (
    input.browser !== 'success' &&
    !(input.browser === 'skipped' && process.env.BROWSER_SCRIPT === 'none')
  )
    throw new Error(
      'Candidate receipt requires completed browser acceptance or an explicitly declared service without UI.',
    );
  const receipt = candidateReceiptSchema.parse({
    formatVersion: 1,
    issuer: await currentContext(config),
    release: selectedRelease(release),
    preview: { worker: config.previewWorker, origin: config.previewUrl, version: input.version },
    checks: {
      artifact: 'success',
      smoke: 'success',
      browser: input.browser === 'success' ? 'success' : 'not-applicable',
    },
  });
  await mkdir(input.directory, { recursive: true });
  await writeFile(path.join(input.directory, 'candidate.json'), JSON.stringify(receipt) + '\n', {
    flag: 'wx',
  });
}
async function downloadArtifact(repository: string, id: number): Promise<string> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-candidate-proof-'));
  try {
    const zip = path.join(temporary, 'candidate.zip');
    const { stdout } = await execute(
      'gh',
      ['api', `repos/${repository}/actions/artifacts/${id}/zip`],
      { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 },
    );
    await writeFile(zip, stdout);
    const { stdout: receipt } = await execute('unzip', ['-p', zip, 'candidate.json'], {
      maxBuffer: 1024 * 1024,
    });
    return receipt;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
function operations(repository: string): CandidateOperations {
  return {
    getRun: async (id) => await githubJson(['api', `repos/${repository}/actions/runs/${id}`]),
    getJobs: async (id) =>
      await githubJson([
        'api',
        `repos/${repository}/actions/runs/${id}/jobs?filter=latest&per_page=100`,
      ]),
    getArtifacts: async (id) =>
      await githubJson(['api', `repos/${repository}/actions/runs/${id}/artifacts?per_page=100`]),
    downloadArtifact: async (id) => await downloadArtifact(repository, id),
  };
}
function assertRun(value: unknown, config: ReleaseConfiguration, context: CandidateContext): void {
  z.object({
    id: z.number().refine((id) => String(id) === context.runId),
    run_attempt: z.number().refine((attempt) => String(attempt) === context.attempt),
    head_sha: z.literal(context.toolsCommit),
    head_branch: z.literal('main'),
    event: z.literal('workflow_dispatch'),
    path: z
      .string()
      .refine(
        (value) => value.split('@')[0] === `.github/workflows/${config.promotionWorkflow.file}`,
      ),
    repository: z.object({ full_name: z.literal(config.repository) }),
    head_repository: z.object({ full_name: z.literal(config.repository) }),
  }).parse(value);
}
function assertCompletedCandidate(value: unknown): void {
  const jobs = z
    .object({
      jobs: z.array(
        z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() }),
      ),
    })
    .parse(value)
    .jobs.filter((job) => /(^| \/ )Verify named release candidate$/.test(job.name));
  if (jobs.length !== 1 || jobs[0]?.status !== 'completed' || jobs[0].conclusion !== 'success')
    throw new Error('Current promotion run has no uniquely completed successful candidate job.');
}
function selectedArtifact(value: unknown, name: string, context: CandidateContext): number {
  const artifacts = z
    .object({
      artifacts: z.array(
        z.object({
          id: z.number().int().positive(),
          name: z.string(),
          expired: z.boolean(),
          workflow_run: z.object({ id: z.number(), head_sha: z.string(), head_branch: z.string() }),
        }),
      ),
    })
    .parse(value)
    .artifacts.filter((artifact) => artifact.name === name);
  const artifact = artifacts[0];
  if (
    artifacts.length !== 1 ||
    !artifact ||
    artifact.expired ||
    String(artifact.workflow_run.id) !== context.runId ||
    artifact.workflow_run.head_sha !== context.toolsCommit ||
    artifact.workflow_run.head_branch !== 'main'
  )
    throw new Error('Candidate proof must be one retained artifact from the current trusted run.');
  return artifact.id;
}
export async function verifyCandidateReceipt(
  config: ReleaseConfiguration,
  release: WebsiteRelease,
  directory: string,
  options: { context?: CandidateContext; operations?: CandidateOperations } = {},
): Promise<CandidateReceipt> {
  const context = options.context ?? (await currentContext(config));
  const tools = options.operations ?? operations(config.repository);
  const file = path.join(directory, 'candidate.json');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw new Error('Candidate proof must be a regular receipt smaller than1MiB.');
  const text = await readFile(file, 'utf8');
  const receipt = candidateReceiptSchema.parse(JSON.parse(text));
  if (
    !isDeepStrictEqual(receipt.issuer, context) ||
    !isDeepStrictEqual(receipt.release, selectedRelease(release)) ||
    receipt.preview.worker !== config.previewWorker ||
    receipt.preview.origin !== config.previewUrl
  )
    throw new Error(
      'Candidate proof does not match this run, tools, selected artifact, app, and preview namespace.',
    );
  assertRun(await tools.getRun(context.runId), config, context);
  assertCompletedCandidate(await tools.getJobs(context.runId));
  const id = selectedArtifact(
    await tools.getArtifacts(context.runId),
    candidateArtifactName(context, config.profile),
    context,
  );
  const retained = await tools.downloadArtifact(id);
  if (
    createHash('sha256').update(retained).digest('hex') !==
    createHash('sha256').update(text).digest('hex')
  )
    throw new Error('Candidate proof bytes differ from the immutable current-run artifact.');
  return receipt;
}
