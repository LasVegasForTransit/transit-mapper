import { verifyExpectedProductionVersion } from './expected-production-version.js';
import { productionEndpoint } from './release-path.js';
import { createCandidateReceipt, verifyCandidateReceipt } from './release-candidate.js';
import { verifyReleaseAttestation } from './release-attestation.js';
import {
  assertNamedPreviewProtection,
  deployNamedSavedRelease,
  verifyNamedPreview,
} from './named-worker-release.js';
import { verifyWorkerReleaseConfiguration } from './worker-release-configuration.js';
import { packageCfRelease } from './cf-release-artifact.js';
import { packageTypedWorkerRelease } from './typed-worker-release-artifact.js';
import { packageLegacyWorkerRelease } from './legacy-worker-release-artifact.js';
import type { ReleaseConfiguration } from './release-config.js';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { previewUploadReceipt } from './pr-preview-config.js';
import { verifyRelease, type WebsiteRelease } from './saved-release-artifact.js';
import { releaseSource } from './release-source.js';
import { selectedLegacyRelease } from './legacy-release-attestation.js';
import { accessCredentials } from './access-auth.js';
import { readReleaseIdentity } from './release-identity.js';
import { resolveRelease } from './resolve-release.js';
import { githubJson } from './release-github.js';

const execute = promisify(execFile);
function printRelease(release: WebsiteRelease): void {
  process.stdout.write(
    `${JSON.stringify({ commit: release.commit, releaseId: release.releaseId, artifactHash: release.artifactHash, fileCount: release.files.length })}\n`,
  );
}
interface ReleaseOptions {
  directory?: string;
  commit?: string;
  'release-id'?: string;
  target?: string;
  version?: string;
  'run-file'?: string;
  repository?: string;
  'run-id'?: string;
  'attestation-directory'?: string;
  'candidate-directory'?: string;
  'expected-version'?: string;
  verification?: string;
}
async function sourceRelease(config: ReleaseConfiguration, values: ReleaseOptions): Promise<void> {
  if (!values.repository || values.repository !== config.repository)
    throw new Error('Pass the configured --repository.');
  const source =
    values['run-file'] && values['run-id']
      ? releaseSource(
          JSON.parse(await readFile(values['run-file'], 'utf8')),
          values.repository,
          values['run-id'],
          config.stagingWorkflow,
        )
      : await resolveRelease(
          values.repository,
          values['run-id'] === '' ? undefined : values['run-id'],
          {
            previewIdentity: async () => {
              const credentials = accessCredentials(process.env);
              if (!credentials)
                throw new Error(
                  'The worker-preview environment needs its Access service credentials.',
                );
              return await readReleaseIdentity(config.previewUrl, {
                credentials,
                app: config.profile,
              });
            },
            getRun: async (id) =>
              await githubJson(['api', `repos/${values.repository}/actions/runs/${id}`]),
            getArtifacts: async (id) =>
              await githubJson([
                'api',
                `repos/${values.repository}/actions/runs/${id}/artifacts?per_page=100`,
              ]),
          },
          config,
        );
  const legacy = await selectedLegacyRelease(config, source);
  const output = process.env.GITHUB_OUTPUT;
  if (output)
    await writeFile(
      output,
      `commit=${source.commit}\nrelease-id=${source.releaseId}\nlegacy=${legacy}\n`,
      {
        flag: 'a',
      },
    );
  process.stdout.write(`${JSON.stringify({ ...source, legacy })}\n`);
}
async function uploadVersionRelease(
  config: ReleaseConfiguration,
  directory: string,
  release: WebsiteRelease,
  target: string,
): Promise<void> {
  if (!config.workersDevSubdomain)
    throw new Error(
      'Configure the reviewed workersDevSubdomain before uploading a release candidate.',
    );
  await verifyWorkerReleaseConfiguration(directory, config);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-release-upload-'));
  try {
    // Wrangler may write cache files; its working copy cannot modify the saved release.
    const copy = path.join(temporary, 'release');
    await cp(directory, copy, { recursive: true });
    if ((await verifyRelease(copy)).artifactHash !== release.artifactHash)
      throw new Error('Saved release changed while preparing upload.');
    const receiptPath = path.join(temporary, 'receipt.jsonl');
    await execute(
      'pnpm',
      [
        'exec',
        'wrangler',
        'versions',
        'upload',
        '--name',
        target === 'preview' ? config.previewWorker : config.productionWorker,
        '--config',
        path.join(copy, 'wrangler.jsonc'),
        '--env',
        target === 'preview' ? 'preview' : '',
        '--no-bundle',
        '--preview-alias',
        `release-${release.releaseId}`,
        '--message',
        `Release ${release.releaseId} at ${release.commit}`,
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
      target === 'preview' ? config.previewWorker : config.productionWorker,
      config.workersDevSubdomain,
    );
    const output = process.env.GITHUB_OUTPUT;
    if (output)
      await writeFile(
        output,
        `url=${receipt.url}\nversion=${receipt.version}\nartifact-hash=${release.artifactHash}\n`,
        { flag: 'a' },
      );
    process.stdout.write(
      `${JSON.stringify({ ...receipt, releaseId: release.releaseId, commit: release.commit, artifactHash: release.artifactHash })}\n`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
async function activateVersionRelease(
  config: ReleaseConfiguration,
  values: ReleaseOptions,
  directory: string,
  release: WebsiteRelease,
): Promise<void> {
  const target = values.target;
  if (target !== 'preview' && target !== 'production')
    throw new Error('Pass --target preview or production.');
  if (!values.version || !/^[a-f0-9-]{36}$/.test(values.version))
    throw new Error('Pass an explicit Worker version ID.');
  await verifyWorkerReleaseConfiguration(directory, config);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-release-activate-'));
  try {
    const copy = path.join(temporary, 'release');
    await cp(directory, copy, { recursive: true });
    if ((await verifyRelease(copy)).artifactHash !== release.artifactHash)
      throw new Error('Saved release changed while preparing activation.');
    const { stdout } = await execute(
      'pnpm',
      [
        'exec',
        'wrangler',
        'versions',
        'deploy',
        `${values.version}@100%`,
        '--name',
        target === 'preview' ? config.previewWorker : config.productionWorker,
        '--config',
        path.join(copy, 'wrangler.jsonc'),
        '--env',
        target === 'preview' ? 'preview' : '',
        '--yes',
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    process.stdout.write(stdout);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
async function namedOperation(
  config: ReleaseConfiguration,
  directory: string,
  release: WebsiteRelease,
  operation: { values: ReleaseOptions; upload: boolean },
): Promise<void> {
  const { values, upload } = operation;
  await verifyWorkerReleaseConfiguration(directory, config);
  if (upload) await assertNamedPreviewProtection(config);
  else if (values['candidate-directory'])
    await verifyCandidateReceipt(config, release, values['candidate-directory']);
  else await verifyNamedPreview(config, release);
  const receipt =
    !upload && values.target === 'preview'
      ? { version: values.version }
      : await deployNamedSavedRelease(
          config,
          directory,
          release,
          upload ? 'preview' : 'production',
        );
  const origin =
    upload || values.target === 'preview' ? config.previewUrl : productionEndpoint(config);
  const protectedPreview = upload || values.target === 'preview';
  const output = process.env.GITHUB_OUTPUT;
  if (output)
    await writeFile(
      output,
      `url=${origin}\nversion=${receipt.version ?? ''}\nartifact-hash=${release.artifactHash}\nprotected=${protectedPreview}\n`,
      { flag: 'a' },
    );
  process.stdout.write(
    `${JSON.stringify({ ...receipt, url: origin, protected: protectedPreview, artifactHash: release.artifactHash })}\n`,
  );
}
function verifySelectedIdentity(release: WebsiteRelease, values: ReleaseOptions): void {
  if (values.commit && release.commit !== values.commit)
    throw new Error('Release commit does not match the selected Actions run.');
  if (values['release-id'] && release.releaseId !== values['release-id'])
    throw new Error('Release ID does not match the selected Actions run.');
}
async function packageSelectedRelease(
  config: ReleaseConfiguration,
  directory: string,
  values: ReleaseOptions,
): Promise<WebsiteRelease> {
  if (!values.commit || !values['release-id']) throw new Error('Pass --commit and --release-id.');
  const identity = {
    commit: values.commit,
    releaseId: values['release-id'],
    ...(config.profile ? { app: config.profile } : {}),
  };
  if (config.artifactSource === 'typed-worker')
    return await packageTypedWorkerRelease(process.cwd(), directory, identity, config);
  if (config.artifactSource === 'cf-output')
    return await packageCfRelease(process.cwd(), directory, identity, config);
  return await packageLegacyWorkerRelease(process.cwd(), directory, identity, config);
}
export async function runWorkerRelease(
  config: ReleaseConfiguration,
  args: string[] = process.argv.slice(2),
): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      directory: { type: 'string' },
      commit: { type: 'string' },
      'release-id': { type: 'string' },
      target: { type: 'string' },
      version: { type: 'string' },
      'run-file': { type: 'string' },
      repository: { type: 'string' },
      'run-id': { type: 'string' },
      'attestation-directory': { type: 'string' },
      'candidate-directory': { type: 'string' },
      'expected-version': { type: 'string' },
      verification: { type: 'string' },
    },
  });
  if (
    process.env.LVBT_RELEASE_PUBLICATION_MODE &&
    process.env.LVBT_RELEASE_PUBLICATION_MODE !== (config.publicationMode ?? 'version')
  )
    throw new Error('Workflow publication mode does not match the selected release configuration.');
  const command = positionals[0];
  const directory = values.directory ? path.resolve(values.directory) : undefined;
  if (command === 'source') {
    await sourceRelease(config, values);
    return;
  }
  if (!directory) throw new Error('Pass --directory.');
  if (command === 'package') {
    printRelease(await packageSelectedRelease(config, directory, values));
    return;
  }
  if (!['verify', 'upload', 'activate', 'candidate'].includes(command ?? ''))
    throw new Error('Use source, package, verify, upload, or activate.');
  await runSavedOperation(config, values, directory, command);
}
async function runSavedOperation(
  config: ReleaseConfiguration,
  values: ReleaseOptions,
  directory: string,
  command: string | undefined,
): Promise<void> {
  const release = await verifyRelease(directory);
  verifySelectedIdentity(release, values);
  if (release.app !== config.profile) throw new Error('Saved release belongs to another app.');
  if (command === 'candidate') {
    if (!values['candidate-directory'] || !values.version)
      throw new Error('Pass --candidate-directory and --version.');
    await verifyReleaseAttestation(config, directory, values['attestation-directory']);
    await verifyNamedPreview(config, release);
    await createCandidateReceipt(config, release, {
      directory: values['candidate-directory'],
      version: values.version,
      browser: values.verification ?? '',
    });
    return;
  }
  if (command === 'verify') {
    await verifyReleaseAttestation(config, directory, values['attestation-directory']);
    printRelease(release);
    return;
  }
  const target = values.target;
  if (target !== 'preview' && target !== 'production')
    throw new Error('Pass --target preview or production.');
  if (target === 'production' && config.previewOnly)
    throw new Error('Preview-only apps cannot publish production releases.');
  await verifyReleaseAttestation(config, directory, values['attestation-directory']);
  if (target === 'production')
    await verifyExpectedProductionVersion(config, values['expected-version'], directory);
  if (config.publicationMode === 'named-staging')
    await namedOperation(config, directory, release, { values, upload: command === 'upload' });
  else if (command === 'activate') await activateVersionRelease(config, values, directory, release);
  else await uploadVersionRelease(config, directory, release, target);
}
