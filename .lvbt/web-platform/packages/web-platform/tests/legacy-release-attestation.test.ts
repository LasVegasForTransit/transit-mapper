import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { sealSavedRelease } from '../src/saved-release-artifact.js';
import { verifyReleaseAttestation } from '../src/release-attestation.js';
import {
  legacyArtifactsSchema,
  selectedLegacyRelease,
  verifyLegacyReleaseAttestation,
} from '../src/legacy-release-attestation.js';

const commit = 'a'.repeat(40);
const record = {
  runId: '123',
  sourceCommit: commit,
  artifactId: 456,
  expiresAt: '2027-01-01T00:00:00Z',
};
const config = {
  repository: 'LasVegasForTransit/website',
  artifactPrefix: 'website-release',
  stagingWorkflow: {
    name: 'Deploy staging',
    path: '.github/workflows/deploy-production.yml',
    branch: 'main',
  },
  attestation: { legacyArtifacts: [record] },
};
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function artifact(formatVersion: 1 | 2 = 1, content = 'reviewed bytes') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'legacy-attestation-fixture-'));
  roots.push(root);
  await mkdir(path.join(root, '.wrangler/worker'), { recursive: true });
  await writeFile(path.join(root, 'wrangler.jsonc'), '{}');
  await writeFile(path.join(root, '.wrangler/worker/index.js'), content);
  await sealSavedRelease(root, { commit, releaseId: record.runId }, 'worker', formatVersion);
  return root;
}
function remote(source: string) {
  const run = {
    id: 123,
    run_attempt: 1,
    name: config.stagingWorkflow.name,
    path: config.stagingWorkflow.path,
    event: 'push',
    head_branch: 'main',
    head_sha: commit,
    status: 'completed',
    conclusion: 'success',
    repository: { full_name: config.repository, id: 789 },
    head_repository: { full_name: config.repository, id: 789 },
  };
  const metadata = {
    id: record.artifactId,
    name: `website-release-${record.runId}`,
    expired: false,
    expires_at: record.expiresAt,
    workflow_run: {
      id: 123,
      head_sha: commit,
      head_branch: 'main',
      repository_id: 789,
      head_repository_id: 789,
    },
  };
  const json = vi.fn((args: string[]): Promise<unknown> => {
    const route = args[1];
    if (route === `repos/${config.repository}`)
      return Promise.resolve({ id: 789, default_branch: 'main' });
    if (route?.endsWith('/runs/123')) return Promise.resolve(run);
    if (route?.endsWith('/artifacts/456')) return Promise.resolve(metadata);
    if (route?.endsWith('/runs/123/artifacts?per_page=100'))
      return Promise.resolve({ total_count: 1, artifacts: [metadata] });
    throw new Error(`Unexpected read ${route}`);
  });
  const download = vi.fn(async (args: string[]) => {
    const destination = args[args.indexOf('--dir') + 1];
    if (!destination) throw new Error('Missing private download destination');
    await cp(source, destination, { recursive: true });
    return '';
  });
  return { run, metadata, json, download, now: () => Date.parse('2026-10-07T00:00:00Z') };
}

test('only the pinned retained v1 bytes establish unsigned compatibility and private files are removed', async () => {
  const local = await artifact();
  const readers = remote(await artifact());
  await expect(verifyLegacyReleaseAttestation(config, local, readers)).resolves.toBe(true);
  expect(readers.download).toHaveBeenCalledWith([
    'run',
    'download',
    '123',
    '--repo',
    config.repository,
    '--name',
    'website-release-123',
    '--dir',
    expect.any(String),
  ]);
  const destination = readers.download.mock.calls[0]?.[0].at(-1);
  if (!destination) throw new Error('No private download was captured');
  await expect(
    import('node:fs/promises').then(({ lstat }) => lstat(destination)),
  ).rejects.toThrow();
  expect(
    readers.json.mock.calls.filter(([args]) => args[1]?.endsWith('/artifacts/456')),
  ).toHaveLength(2);
});

test('source selection may flag exact legacy metadata but never downloads or authorizes bytes', async () => {
  const readers = remote(await artifact());
  await expect(selectedLegacyRelease(config, { releaseId: '123', commit }, readers)).resolves.toBe(
    true,
  );
  expect(readers.download).not.toHaveBeenCalled();
  await expect(selectedLegacyRelease(config, { releaseId: '124', commit }, readers)).resolves.toBe(
    false,
  );
});

test('new format artifacts cannot use an old run allowance', async () => {
  const readers = remote(await artifact());
  await expect(verifyLegacyReleaseAttestation(config, await artifact(2), readers)).resolves.toBe(
    false,
  );
  expect(readers.json).not.toHaveBeenCalled();
  expect(readers.download).not.toHaveBeenCalled();
});

test('changed local and remotely self-consistent bytes cannot be substituted for each other', async () => {
  const readers = remote(await artifact(1, 'different reviewed inventory'));
  await expect(verifyLegacyReleaseAttestation(config, await artifact(), readers)).rejects.toThrow(
    'inventory',
  );
});

test.each([
  [
    'artifact ID',
    (r: ReturnType<typeof remote>) => {
      r.metadata.id = 999;
    },
  ],
  [
    'artifact expiry',
    (r: ReturnType<typeof remote>) => {
      r.metadata.expires_at = '2027-02-01T00:00:00Z';
    },
  ],
  [
    'expired metadata',
    (r: ReturnType<typeof remote>) => {
      r.metadata.expired = true;
    },
  ],
  [
    'source SHA',
    (r: ReturnType<typeof remote>) => {
      r.run.head_sha = 'b'.repeat(40);
    },
  ],
  [
    'failed run',
    (r: ReturnType<typeof remote>) => {
      r.run.conclusion = 'failure';
    },
  ],
  [
    'fork run',
    (r: ReturnType<typeof remote>) => {
      r.run.head_repository.full_name = 'foreign/website';
    },
  ],
  [
    'foreign artifact',
    (r: ReturnType<typeof remote>) => {
      r.metadata.workflow_run.repository_id = 999;
    },
  ],
  [
    'different workflow',
    (r: ReturnType<typeof remote>) => {
      r.run.path = '.github/workflows/other.yml';
    },
  ],
])('rejects %s before downloading', async (_name, mutate) => {
  const readers = remote(await artifact());
  mutate(readers);
  await expect(verifyLegacyReleaseAttestation(config, await artifact(), readers)).rejects.toThrow();
  expect(readers.download).not.toHaveBeenCalled();
});

test('expiry is bounded by the reviewed deadline even if the remote artifact still exists', async () => {
  const readers = remote(await artifact());
  readers.now = () => Date.parse(record.expiresAt);
  await expect(verifyLegacyReleaseAttestation(config, await artifact(), readers)).rejects.toThrow(
    'expired',
  );
  expect(readers.download).not.toHaveBeenCalled();
});

test('changed metadata after download and changed default branch are refused', async () => {
  const readers = remote(await artifact());
  readers.download.mockImplementation(async (args) => {
    const destination = args.at(-1);
    if (!destination) throw new Error('Missing private download destination');
    await cp(await artifact(), destination, { recursive: true });
    readers.metadata.id = 999;
    return '';
  });
  await expect(verifyLegacyReleaseAttestation(config, await artifact(), readers)).rejects.toThrow();
  readers.metadata.id = record.artifactId;
  const json = readers.json.getMockImplementation();
  if (!json) throw new Error('Missing metadata reader');
  readers.json.mockImplementation(async (args) =>
    args[1] === `repos/${config.repository}` ? { id: 789, default_branch: 'develop' } : json(args),
  );
  await expect(
    selectedLegacyRelease(config, { releaseId: '123', commit }, readers),
  ).rejects.toThrow();
});

test('policy rejects duplicate run IDs, duplicate artifact IDs and malformed expiry', () => {
  expect(legacyArtifactsSchema.safeParse([record, { ...record, artifactId: 999 }]).success).toBe(
    false,
  );
  expect(legacyArtifactsSchema.safeParse([record, { ...record, runId: '999' }]).success).toBe(
    false,
  );
  expect(legacyArtifactsSchema.safeParse([{ ...record, expiresAt: 'tomorrow' }]).success).toBe(
    false,
  );
});

test.each([true, false])(
  'truncated or ambiguous download names cannot select a different artifact (%s)',
  async (truncated) => {
    const readers = remote(await artifact());
    const json = readers.json.getMockImplementation();
    if (!json) throw new Error('Missing reader');
    readers.json.mockImplementation((args) =>
      args[1]?.endsWith('/runs/123/artifacts?per_page=100')
        ? Promise.resolve(
            truncated
              ? { total_count: 101, artifacts: [readers.metadata] }
              : { total_count: 2, artifacts: [readers.metadata, { ...readers.metadata, id: 999 }] },
          )
        : json(args),
    );
    await expect(verifyLegacyReleaseAttestation(config, await artifact(), readers)).rejects.toThrow(
      'inventory',
    );
    expect(readers.download).not.toHaveBeenCalled();
  },
);

test('a local artifact changed during remote verification cannot gain authorization', async () => {
  const local = await artifact();
  const source = await artifact();
  const readers = remote(source);
  readers.download.mockImplementation(async (args) => {
    const destination = args.at(-1);
    if (!destination) throw new Error('Missing destination');
    await cp(source, destination, { recursive: true });
    await writeFile(path.join(local, '.wrangler/worker/index.js'), 'changed during download');
    return '';
  });
  await expect(verifyLegacyReleaseAttestation(config, local, readers)).rejects.toThrow();
});

test('the ordinary signed-proof verifier independently authorizes exact old bytes through real GitHub CLI boundaries', async () => {
  const local = await artifact();
  const source = await artifact();
  const readers = remote(source);
  const bin = await mkdtemp(path.join(os.tmpdir(), 'legacy-gh-fixture-'));
  roots.push(bin);
  const fixture = path.join(bin, 'fixture.json');
  const capture = path.join(bin, 'calls.jsonl');
  await writeFile(
    fixture,
    JSON.stringify({ source, run: readers.run, metadata: readers.metadata }),
  );
  await writeFile(
    path.join(bin, 'gh'),
    `#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.LEGACY_CAPTURE,JSON.stringify(args)+'\\n');
const value=JSON.parse(fs.readFileSync(process.env.LEGACY_FIXTURE,'utf8'));
if(args[0]==='run'&&args[1]==='download') fs.cpSync(value.source,args.at(-1),{recursive:true});
else if(args[0]==='api') {
 const route=args[1];
 const response=route.endsWith('/runs/123/artifacts?per_page=100')?{total_count:1,artifacts:[value.metadata]}:
 route.endsWith('/artifacts/456')?value.metadata:route.endsWith('/runs/123')?value.run:{id:789,default_branch:'main'};
 process.stdout.write(JSON.stringify(response));
} else process.exit(9);
`,
  );
  await chmod(path.join(bin, 'gh'), 0o755);
  vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH}`);
  vi.stubEnv('LEGACY_FIXTURE', fixture);
  vi.stubEnv('LEGACY_CAPTURE', capture);
  const fullConfig = {
    ...config,
    attestation: {
      ...config.attestation,
      signerWorkflow: 'LasVegasForTransit/repository-tooling/.github/workflows/release-attest.yml',
      signerCommit: 'b'.repeat(40),
    },
  };
  await expect(verifyReleaseAttestation(fullConfig, local)).resolves.toBeUndefined();
  const calls = (await readFile(capture, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[]);
  expect(calls.filter((args) => args[0] === 'run')).toHaveLength(1);
  expect(calls.filter((args) => args[1]?.endsWith('/artifacts/456'))).toHaveLength(2);
  await expect(verifyReleaseAttestation(fullConfig, await artifact(2))).rejects.toThrow(
    'attestation',
  );
  await expect(
    verifyReleaseAttestation(fullConfig, local, path.join(bin, 'missing-proof')),
  ).rejects.toThrow();
  expect((await readFile(capture, 'utf8')).trim().split('\n')).toHaveLength(calls.length);
});
