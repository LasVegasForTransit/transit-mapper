import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { github, githubJson } from './release-github.js';
import { releaseSource, type StagingWorkflow } from './release-source.js';
import { verifyRelease, type SavedReleaseIdentity } from './saved-release-artifact.js';

const identifier = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const legacyArtifactsSchema = z
  .array(
    z.strictObject({
      runId: z.string().regex(/^[1-9][0-9]*$/),
      sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
      artifactId: identifier,
      expiresAt: z.iso.datetime(),
    }),
  )
  .max(100)
  .refine(
    (records) =>
      new Set(records.map((record) => record.runId)).size === records.length &&
      new Set(records.map((record) => record.artifactId)).size === records.length,
    'Legacy run and artifact IDs must be unique.',
  );
type LegacyArtifact = z.infer<typeof legacyArtifactsSchema>[number];
interface Configuration {
  repository: string;
  artifactPrefix?: string;
  stagingWorkflow?: StagingWorkflow;
  attestation?: { legacyArtifacts?: LegacyArtifact[] | undefined } | undefined;
}
interface Dependencies {
  json?: typeof githubJson;
  download?: typeof github;
  now?: () => number;
}
const metadataSchema = z.object({
  id: identifier,
  name: z.string(),
  expired: z.literal(false),
  expires_at: z.iso.datetime(),
  workflow_run: z.object({
    id: identifier,
    head_sha: z.string(),
    head_branch: z.string(),
    repository_id: identifier,
    head_repository_id: identifier,
  }),
});

function selectedRecord(config: Configuration, identity: SavedReleaseIdentity, now: () => number) {
  const records = legacyArtifactsSchema.parse(config.attestation?.legacyArtifacts ?? []);
  const record = records.find((value) => value.runId === identity.releaseId);
  if (record?.sourceCommit !== identity.commit) return undefined;
  if (Date.parse(record.expiresAt) <= now())
    throw new Error('Legacy attestation allowance expired.');
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(config.repository) ||
    !config.artifactPrefix ||
    !config.stagingWorkflow
  )
    throw new Error('Legacy provenance requires the configured repository and staging workflow.');
  return record;
}

async function verifiedMetadata(
  config: Configuration,
  record: LegacyArtifact,
  dependencies: Dependencies,
) {
  const json = dependencies.json ?? githubJson;
  const repo = `repos/${config.repository}`;
  const repository = z
    .object({ id: identifier, default_branch: z.string() })
    .parse(await json(['api', repo]));
  const branch = config.stagingWorkflow?.branch ?? 'main';
  if (repository.default_branch !== branch)
    throw new Error('Legacy source is not on the default branch.');
  const run = await json(['api', `${repo}/actions/runs/${record.runId}`]);
  const source = releaseSource(run, config.repository, record.runId, config.stagingWorkflow);
  const owners = z
    .object({
      repository: z.object({ id: identifier }),
      head_repository: z.object({ id: identifier }),
    })
    .parse(run);
  if (
    source.commit !== record.sourceCommit ||
    owners.repository.id !== repository.id ||
    owners.head_repository.id !== repository.id
  )
    throw new Error('Legacy source does not match its reviewed run and repository.');
  const artifact = metadataSchema.parse(
    await json(['api', `${repo}/actions/artifacts/${record.artifactId}`]),
  );
  const expectedName = `${config.artifactPrefix}-${record.runId}`;
  const expected = {
    id: record.artifactId,
    name: expectedName,
    expired: false,
    expires_at: record.expiresAt,
    workflow_run: {
      id: Number(record.runId),
      head_sha: record.sourceCommit,
      head_branch: branch,
      repository_id: repository.id,
      head_repository_id: repository.id,
    },
  };
  if (
    !isDeepStrictEqual(artifact, expected) ||
    Date.parse(artifact.expires_at) <= (dependencies.now ?? Date.now)()
  )
    throw new Error('Legacy artifact metadata changed or expired.');
  const inventory = z
    .object({
      total_count: z.number().int().nonnegative(),
      artifacts: z.array(z.object({ id: identifier, name: z.string() })),
    })
    .parse(await json(['api', `${repo}/actions/runs/${record.runId}/artifacts?per_page=100`]));
  const matches = inventory.artifacts.filter((value) => value.name === expectedName);
  if (
    inventory.total_count !== inventory.artifacts.length ||
    matches.length !== 1 ||
    matches[0]?.id !== record.artifactId
  )
    throw new Error('Legacy artifact inventory is changed, truncated or ambiguous.');
  return artifact;
}

/** Selection controls proof download only; publication must independently verify retained bytes. */
export async function selectedLegacyRelease(
  config: Configuration,
  identity: SavedReleaseIdentity,
  dependencies: Dependencies = {},
): Promise<boolean> {
  const record = selectedRecord(config, identity, dependencies.now ?? Date.now);
  if (!record) return false;
  const before = await verifiedMetadata(config, record, dependencies);
  const after = await verifiedMetadata(config, record, dependencies);
  if (!isDeepStrictEqual(before, after))
    throw new Error('Legacy metadata changed during selection.');
  return true;
}

/** A bounded migration exception for exact remotely retained v1 content, never newly produced bytes. */
export async function verifyLegacyReleaseAttestation(
  config: Configuration,
  directory: string,
  dependencies: Dependencies = {},
): Promise<boolean> {
  const local = await verifyRelease(directory);
  if (local.formatVersion !== 1) return false;
  const record = selectedRecord(config, local, dependencies.now ?? Date.now);
  if (!record) return false;
  const before = await verifiedMetadata(config, record, dependencies);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-legacy-attestation-'));
  try {
    await (dependencies.download ?? github)([
      'run',
      'download',
      record.runId,
      '--repo',
      config.repository,
      '--name',
      before.name,
      '--dir',
      temporary,
    ]);
    const retained = await verifyRelease(temporary);
    if (!isDeepStrictEqual(local, retained))
      throw new Error('Legacy retained inventory does not match the selected bytes.');
    const after = await verifiedMetadata(config, record, dependencies);
    if (!isDeepStrictEqual(before, after))
      throw new Error('Legacy metadata changed during verification.');
    // A downloaded or provider response cannot authorize a concurrently changed local artifact.
    if (!isDeepStrictEqual(local, await verifyRelease(directory)))
      throw new Error('Legacy local inventory changed during verification.');
    return true;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
