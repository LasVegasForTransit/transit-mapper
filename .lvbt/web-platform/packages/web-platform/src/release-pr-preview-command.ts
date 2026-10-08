import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ReleaseConfiguration } from './release-config.js';
import { accessCredentials, accessFetch } from './access-auth.js';
import { deployNamedSavedRelease } from './named-worker-release.js';
import {
  assertPrPreviewEvent,
  namedPrConfiguration,
  prPreviewConfiguration,
  prPreviewArguments,
} from './release-pr-preview-config.js';
import { packageTypedWorkerRelease } from './typed-worker-release-artifact.js';
import { sealSavedRelease } from './saved-release-artifact.js';
import { runReleaseMigrations } from './saved-release-migrations.js';
import { verifyWorkerReleaseConfiguration } from './worker-release-configuration.js';
import { runWorkerPreview } from './worker-preview-command.js';
import { verifyWorkerReleaseSmoke } from './worker-release-smoke.js';
import { deleteNamedPrPreview } from './release-pr-preview-delete.js';
export { prPreviewConfiguration } from './release-pr-preview-config.js';

async function previewCredentials(config: ReleaseConfiguration, protection: string) {
  if (protection === 'public') return undefined;
  const anonymous = await accessFetch(config.previewUrl, config.previewUrl);
  if (![302, 401, 403].includes(anonymous.status))
    throw new Error('Anonymous request reached PR preview.');
  await anonymous.arrayBuffer();
  const credentials = accessCredentials(process.env);
  if (!credentials) throw new Error('Protected PR preview requires Access credentials.');
  return credentials;
}

/** PR-only deployment: all saved bytes are private temporary inputs, never promotion artifacts. */
export async function runPrPreview(config: ReleaseConfiguration, args: string[]): Promise<void> {
  const input = prPreviewArguments(args);
  const mode = input.publicationMode;
  if (mode !== (config.publicationMode ?? 'version'))
    throw new Error('PR publication mode differs from the release configuration.');
  const selected = prPreviewConfiguration(config, input.number);
  const identity = {
    commit: input.commit,
    releaseId: input.releaseId,
    ...(config.profile ? { app: config.profile } : {}),
  };
  await assertPrPreviewEvent(config, input);
  if (input.action === 'resolve') {
    const output = process.env.GITHUB_OUTPUT;
    if (output) await writeFile(output, `url=${selected.previewUrl}\n`, { flag: 'a' });
    process.stdout.write(`${JSON.stringify({ url: selected.previewUrl })}\n`);
    return;
  }
  if (input.action === 'delete') {
    if (mode !== 'named-staging') throw new Error('Only named PR Workers support deletion.');
    await deleteNamedPrPreview(selected);
    return;
  }
  if (mode === 'version') {
    await runWorkerPreview(config, [
      '--alias',
      `pr-${input.number}`,
      '--env',
      'preview',
      '--message',
      `PR #${input.number} at ${input.commit}`,
    ]);
    return;
  }
  if (config.artifactSource !== 'typed-worker' || !config.smoke)
    throw new Error('Named PR previews require typed-worker inputs and a declared API smoke.');
  await deployNamedPr(config, { selected, identity, protection: input.protection });
}

async function deployNamedPr(
  config: ReleaseConfiguration,
  input: {
    selected: ReleaseConfiguration;
    identity: { commit: string; releaseId: string; app?: string };
    protection: string;
  },
): Promise<void> {
  const credentials = await previewCredentials(input.selected, input.protection);
  const smoke = config.smoke;
  if (!smoke) throw new Error('Declare the PR API smoke.');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-pr-preview-'));
  try {
    const directory = path.join(temporary, 'release');
    await packageTypedWorkerRelease(process.cwd(), directory, input.identity, config);
    await verifyWorkerReleaseConfiguration(directory, config);
    const file = path.join(directory, 'wrangler.jsonc');
    await writeFile(
      file,
      JSON.stringify(
        namedPrConfiguration(JSON.parse(await readFile(file, 'utf8')), input.selected),
        null,
        2,
      ),
    );
    await rm(path.join(directory, 'release.json'));
    const release = await sealSavedRelease(directory, input.identity, 'worker', 2);
    await verifyWorkerReleaseConfiguration(directory, input.selected);
    await runReleaseMigrations(input.selected, [
      '--directory',
      directory,
      '--target',
      'preview',
      '--commit',
      input.identity.commit,
      '--release-id',
      input.identity.releaseId,
    ]);
    const receipt = await deployNamedSavedRelease(input.selected, directory, release, 'preview');
    await verifyWorkerReleaseSmoke({
      origin: input.selected.previewUrl,
      identity: input.identity,
      smoke,
      publicPath: config.publicPath,
      protected: input.protection === 'access',
      credentials,
      timeoutMs: 180_000,
    });
    const output = process.env.GITHUB_OUTPUT;
    if (output)
      await writeFile(
        output,
        `url=${input.selected.previewUrl}\nversion=${receipt.version}\nprotected=${input.protection === 'access'}\n`,
        { flag: 'a' },
      );
    process.stdout.write(`${JSON.stringify({ url: input.selected.previewUrl, ...receipt })}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
