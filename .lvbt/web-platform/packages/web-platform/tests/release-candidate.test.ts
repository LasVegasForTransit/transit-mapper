import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { verifyCandidateReceipt, type CandidateOperations } from '../src/release-candidate.js';
const config = {
  repository: 'Example/app',
  appDirectory: 'app',
  productionUrl: 'https://example.org',
  previewUrl: 'https://preview.example.org',
  productionWorker: 'app',
  previewWorker: 'app-preview',
  artifactPrefix: 'app-release',
  stagingWorkflow: { name: 'Deploy staging', path: '.github/workflows/deploy.yml', branch: 'main' },
  promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote app', branch: 'main' },
};
const context = {
  runId: '900',
  attempt: '2',
  toolsCommit: 'b'.repeat(40),
  sharedCommit: 'c'.repeat(40),
};
const release = {
  formatVersion: 2 as const,
  commit: 'a'.repeat(40),
  releaseId: '123',
  artifactHash: 'd'.repeat(64),
  files: [],
};
const receipt = {
  formatVersion: 1,
  issuer: context,
  release: {
    commit: release.commit,
    releaseId: release.releaseId,
    artifactHash: release.artifactHash,
  },
  preview: {
    worker: 'app-preview',
    origin: config.previewUrl,
    version: '12345678-1234-4234-8234-123456789abc',
  },
  checks: { artifact: 'success', smoke: 'success', browser: 'success' },
};
const run = {
  id: 900,
  run_attempt: 2,
  head_sha: context.toolsCommit,
  head_branch: 'main',
  event: 'workflow_dispatch',
  path: '.github/workflows/promote.yml',
  repository: { full_name: config.repository },
  head_repository: { full_name: config.repository },
};
const jobs = {
  jobs: [
    {
      name: 'publish / Verify named release candidate',
      status: 'completed',
      conclusion: 'success',
    },
  ],
};
const artifacts = {
  artifacts: [
    {
      id: 55,
      name: 'candidate-900-2',
      expired: false,
      workflow_run: { id: 900, head_sha: context.toolsCommit, head_branch: 'main' },
    },
  ],
};
function operations(override: Partial<CandidateOperations> = {}): CandidateOperations {
  return {
    getRun: () => Promise.resolve(run),
    getJobs: () => Promise.resolve(jobs),
    getArtifacts: () => Promise.resolve(artifacts),
    downloadArtifact: () => Promise.resolve(JSON.stringify(receipt) + '\n'),
    ...override,
  };
}
test('candidate proof binds the same manual run, tools, successful job, artifact bytes, and selected release before production writes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'candidate-proof-'));
  try {
    await writeFile(path.join(directory, 'candidate.json'), JSON.stringify(receipt) + '\n');
    expect(
      await verifyCandidateReceipt(config, release, directory, {
        context,
        operations: operations(),
      }),
    ).toEqual(receipt);
    for (const mutation of [
      { getRun: () => Promise.resolve({ ...run, event: 'push' }) },
      { getRun: () => Promise.resolve({ ...run, head_repository: { full_name: 'Attacker/app' } }) },
      { getJobs: () => Promise.resolve({ jobs: [{ ...jobs.jobs[0], conclusion: 'failure' }] }) },
      {
        getArtifacts: () =>
          Promise.resolve({ artifacts: [{ ...artifacts.artifacts[0], expired: true }] }),
      },
      {
        downloadArtifact: () =>
          Promise.resolve(
            JSON.stringify({ ...receipt, preview: { ...receipt.preview, worker: 'another' } }),
          ),
      },
    ])
      await expect(
        verifyCandidateReceipt(config, release, directory, {
          context,
          operations: operations(mutation),
        }),
      ).rejects.toThrow();
    await expect(
      verifyCandidateReceipt(config, { ...release, artifactHash: 'e'.repeat(64) }, directory, {
        context,
        operations: operations(),
      }),
    ).rejects.toThrow('selected artifact');
    await expect(
      verifyCandidateReceipt(config, release, directory, {
        context: { ...context, attempt: '3' },
        operations: operations(),
      }),
    ).rejects.toThrow('this run');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
