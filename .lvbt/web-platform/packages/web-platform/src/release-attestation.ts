import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { isDeepStrictEqual, parseArgs, promisify } from 'node:util';
import { z } from 'zod';
import type { ReleaseConfiguration } from './release-config.js';
import { verifyRelease, type WebsiteRelease } from './saved-release-artifact.js';
import {
  legacyArtifactsSchema,
  verifyLegacyReleaseAttestation,
} from './legacy-release-attestation.js';

const execute = promisify(execFile);
const signer = z.strictObject({
  signerWorkflow: z.literal(
    'LasVegasForTransit/repository-tooling/.github/workflows/release-attest.yml',
  ),
  signerCommit: z.string().regex(/^[a-f0-9]{40}$/),
  legacyArtifacts: legacyArtifactsSchema.optional(),
});
type AttestationConfig = Pick<ReleaseConfiguration, 'repository'> &
  Partial<Pick<ReleaseConfiguration, 'artifactPrefix' | 'stagingWorkflow'>> & {
    attestation?:
      | {
          signerWorkflow: string;
          signerCommit: string;
          legacyArtifacts?: z.infer<typeof legacyArtifactsSchema> | undefined;
        }
      | undefined;
  };

/** Sign the verified inventory itself, so its digest binds every retained file. */
export async function createReleaseAttestation(
  directory: string,
  proofDirectory: string,
  expected?: Pick<WebsiteRelease, 'commit' | 'releaseId'>,
): Promise<void> {
  const release = await verifyRelease(directory);
  if (expected && (release.commit !== expected.commit || release.releaseId !== expected.releaseId))
    throw new Error('Attestation source does not match the selected build run.');
  await mkdir(proofDirectory, { recursive: true });
  await writeFile(
    path.join(proofDirectory, 'release-attestation.json'),
    `${JSON.stringify(release)}\n`,
    { flag: 'wx' },
  );
}

async function regularProof(file: string): Promise<void> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
    throw new Error('Release attestation proof must contain regular files smaller than16MiB.');
}

/** Require GitHub's signed source and shared-builder identity before trusting the envelope. */
export async function verifyReleaseAttestation(
  config: AttestationConfig,
  directory: string,
  proofDirectory?: string,
): Promise<void> {
  if (!config.attestation) return;
  const expectedSigner = signer.parse(config.attestation);
  if (!proofDirectory && (await verifyLegacyReleaseAttestation(config, directory))) return;
  if (!proofDirectory)
    throw new Error('This release requires --attestation-directory with retained signed proof.');
  const release = await verifyRelease(directory);
  const files = ['release-attestation.json', 'bundle.jsonl'] as const;
  for (const file of files) await regularProof(path.resolve(proofDirectory, file));
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-attestation-'));
  const manifest = path.join(temporary, files[0]);
  const bundle = path.join(temporary, files[1]);
  try {
    for (const file of files)
      await writeFile(
        path.join(temporary, file),
        await readFile(path.resolve(proofDirectory, file)),
        { flag: 'wx' },
      );
    const signed: unknown = JSON.parse(await readFile(manifest, 'utf8'));
    await verifySignature({
      repository: config.repository,
      expectedSigner,
      sourceCommit: release.commit,
      manifest,
      bundle,
    });
    if (!isDeepStrictEqual(signed, release))
      throw new Error('Signed inventory does not match the selected release.');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

interface SignatureInput {
  repository: string;
  expectedSigner: z.infer<typeof signer>;
  sourceCommit: string;
  manifest: string;
  bundle: string;
}
async function verifySignature({
  repository,
  expectedSigner,
  sourceCommit,
  manifest,
  bundle,
}: SignatureInput): Promise<void> {
  try {
    await execute(
      'gh',
      [
        'attestation',
        'verify',
        manifest,
        '--bundle',
        bundle,
        '--repo',
        repository,
        '--signer-workflow',
        expectedSigner.signerWorkflow,
        '--signer-digest',
        expectedSigner.signerCommit,
        '--source-digest',
        sourceCommit,
        '--source-ref',
        'refs/heads/main',
        '--deny-self-hosted-runners',
      ],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch {
    throw new Error('Release attestation verification failed; no publication is authorized.');
  }
}

export async function runReleaseAttestation(
  config: ReleaseConfiguration | undefined,
  args: string[],
): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      directory: { type: 'string' },
      'attestation-directory': { type: 'string' },
      commit: { type: 'string' },
      'release-id': { type: 'string' },
    },
  });
  if (!values.directory || !values['attestation-directory'])
    throw new Error('Pass --directory and --attestation-directory.');
  if (positionals[0] === 'manifest')
    await createReleaseAttestation(
      path.resolve(values.directory),
      path.resolve(values['attestation-directory']),
      values.commit && values['release-id']
        ? { commit: values.commit, releaseId: values['release-id'] }
        : undefined,
    );
  else if (positionals[0] === 'verify') {
    if (!config?.attestation)
      throw new Error('Configure the reviewed attestation signer before verifying proof.');
    await verifyReleaseAttestation(
      config,
      path.resolve(values.directory),
      path.resolve(values['attestation-directory']),
    );
  } else throw new Error('Use attestation manifest or attestation verify.');
}
