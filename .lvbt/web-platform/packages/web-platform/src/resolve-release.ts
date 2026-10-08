import { z } from 'zod';
import { releaseSource, type StagingWorkflow } from './release-source.js';
import type { ReleaseIdentity } from './release-identity.js';

interface SourceReader {
  previewIdentity: () => Promise<ReleaseIdentity>;
  getRun: (id: string) => Promise<unknown>;
  getArtifacts: (id: string) => Promise<unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}
const artifactsSchema = z.object({
  artifacts: z.array(z.object({ name: z.string(), expired: z.boolean() })),
});

async function completedRun(
  selected: string,
  wait: boolean,
  reader: SourceReader,
): Promise<unknown> {
  const now = reader.now ?? Date.now;
  const sleep = reader.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + (reader.timeoutMs ?? 600_000);
  let value = await reader.getRun(selected);
  while (wait && z.object({ status: z.string() }).parse(value).status !== 'completed') {
    if (now() >= deadline)
      throw new Error(`Staging run ${selected} did not finish in time. Nothing was published.`);
    await sleep(Math.min(5_000, deadline - now()));
    value = await reader.getRun(selected);
  }
  return value;
}

export async function resolveRelease(
  repository: string,
  runId: string | undefined,
  reader: SourceReader,
  policy: { artifactPrefix?: string; stagingWorkflow?: StagingWorkflow } = {},
): Promise<ReleaseIdentity> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error('Pass the configured owner/repository.');
  const preview = runId ? undefined : await reader.previewIdentity();
  const selected = runId ?? preview?.releaseId;
  if (!selected || !/^[1-9][0-9]*$/.test(selected)) throw new Error('Select an Actions run ID.');
  // Preview activation precedes the final staging check. Pin this identity while that run finishes.
  const value = await completedRun(selected, Boolean(preview), reader);
  const source = releaseSource(value, repository, selected, policy.stagingWorkflow);
  if (preview && source.commit !== preview.commit)
    throw new Error('Preview identity does not match its staging run.');
  const artifacts = artifactsSchema.parse(await reader.getArtifacts(selected));
  const matches = artifacts.artifacts.filter(
    (artifact) => artifact.name === `${policy.artifactPrefix ?? 'website-release'}-${selected}`,
  );
  if (matches.length !== 1 || matches[0]?.expired)
    throw new Error(`Saved release ${selected} is missing or expired.`);
  return source;
}
