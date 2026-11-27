import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { runIsolatedPrPreview } from '../src/isolated-pr-preview-command.js';
import { releaseConfigurationSchema } from '../src/release-config.js';
import { sealSavedRelease } from '../src/saved-release-artifact.js';
import { assertPreviewBuild, preparePreviewUpload } from '../src/isolated-pr-preview.js';

const identity = { commit: 'a'.repeat(40), releaseId: '123' };
const policy = {
  repository: 'Example/site',
  workflow: '.github/workflows/preview.yml',
  branch: 'main',
};
const run = {
  id: 123,
  event: 'pull_request',
  status: 'completed',
  conclusion: 'success',
  path: policy.workflow,
  head_sha: identity.commit,
  repository: { full_name: policy.repository },
  head_repository: { full_name: policy.repository },
};
const pr = {
  number: 42,
  state: 'open',
  head: { sha: identity.commit, repo: { full_name: policy.repository } },
  base: { ref: 'main', repo: { full_name: policy.repository } },
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test('only the successful current same-repository PR build can supply preview bytes', () => {
  expect(assertPreviewBuild(run, pr, policy, '123')).toEqual({ ...identity, number: 42 });
  for (const changed of [
    { ...run, conclusion: 'failure' },
    { ...run, status: 'in_progress' },
    { ...run, event: 'push' },
    { ...run, path: '.github/workflows/unrelated.yml' },
    { ...run, id: 124 },
    { ...run, head_repository: { full_name: 'Attacker/fork' } },
    { ...run, repository: { full_name: 'Attacker/site' } },
  ])
    expect(() => assertPreviewBuild(changed, pr, policy, '123')).toThrow();
  for (const changed of [
    { ...pr, state: 'closed' },
    { ...pr, base: { ...pr.base, ref: 'other' } },
    { ...pr, head: { ...pr.head, sha: 'b'.repeat(40) } },
    { ...pr, head: { ...pr.head, repo: { full_name: 'Attacker/fork' } } },
  ])
    expect(() => assertPreviewBuild(run, changed, policy, '123')).toThrow();
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'isolated-preview-'));
  directories.push(root);
  const artifact = path.join(root, 'artifact');
  await mkdir(path.join(artifact, '.wrangler/worker'), { recursive: true });
  await mkdir(path.join(artifact, 'dist'));
  // These are upload data; neither the payload nor its malicious configuration may execute.
  await writeFile(
    path.join(artifact, '.wrangler/worker/index.js'),
    'throw new Error("must not execute locally");',
  );
  await writeFile(path.join(artifact, 'dist/index.html'), '<h1>PR preview</h1>');
  await writeFile(
    path.join(artifact, 'wrangler.jsonc'),
    JSON.stringify({
      name: 'production',
      main: '../../outside.js',
      build: { command: 'touch COMPROMISED' },
      d1_databases: [{ binding: 'DB', database_id: 'production-database' }],
    }),
  );
  await sealSavedRelease(artifact, identity, undefined, 2);
  return { root, artifact, destination: path.join(root, 'upload') };
}
const trusted = {
  name: 'site',
  main: 'ignored-main.ts',
  compatibility_date: '2026-09-04',
  compatibility_flags: ['nodejs_compat'],
  assets: { binding: 'ASSETS', directory: '../site/dist' },
  d1_databases: [{ binding: 'DB', database_id: 'production-database' }],
  env: {
    preview: {
      name: 'site-preview',
      assets: { binding: 'ASSETS', directory: '../site/dist' },
      d1_databases: [{ binding: 'DB', database_id: 'isolated-preview-database' }],
      vars: { LVBT_DEPLOYMENT_ENV: 'preview' },
      triggers: { crons: [] },
      unsafe: { metadata: { keep_bindings: ['secret_text', 'secret_key'] } },
    },
  },
};
test('upload ignores PR configuration and retains only compiled bytes with trusted preview bindings', async () => {
  const { artifact, destination } = await fixture();
  await preparePreviewUpload(artifact, destination, trusted, { identity, worker: 'site-preview' });
  const uploaded: unknown = JSON.parse(
    await readFile(path.join(destination, 'wrangler.jsonc'), 'utf8'),
  );
  expect(uploaded).toMatchObject({
    name: 'site-preview',
    main: '.wrangler/worker/index.js',
    assets: { directory: './dist' },
    d1_databases: [{ binding: 'DB', database_id: 'isolated-preview-database' }],
    vars: { LVBT_DEPLOYMENT_ENV: 'preview' },
    triggers: { crons: [] },
  });
  expect(uploaded).not.toHaveProperty('build');
  expect(uploaded).not.toHaveProperty('env');
  expect(await readFile(path.join(destination, 'dist/index.html'), 'utf8')).toBe(
    '<h1>PR preview</h1>',
  );
});
test('changed identity, tampered payloads and symlinks are rejected before upload preparation', async () => {
  const { root, artifact, destination } = await fixture();
  await expect(
    preparePreviewUpload(artifact, destination, trusted, {
      identity: { ...identity, commit: 'b'.repeat(40) },
      worker: 'site-preview',
    }),
  ).rejects.toThrow();
  await writeFile(path.join(artifact, '.wrangler/worker/index.js'), 'changed');
  await expect(
    preparePreviewUpload(artifact, destination, trusted, { identity, worker: 'site-preview' }),
  ).rejects.toThrow();
  await symlink(root, path.join(artifact, 'dist/escape'));
  await expect(
    preparePreviewUpload(artifact, destination, trusted, { identity, worker: 'site-preview' }),
  ).rejects.toThrow();
});

test('compiled PR modules cannot make Wrangler read files outside the upload payload', async () => {
  const { artifact, destination } = await fixture();
  await rm(path.join(artifact, 'release.json'));
  await writeFile(
    path.join(artifact, '.wrangler/worker/index.js'),
    'import "../../../../etc/credential.js"; export default {};',
  );
  await sealSavedRelease(artifact, identity, undefined, 2);
  await expect(
    preparePreviewUpload(artifact, destination, trusted, { identity, worker: 'site-preview' }),
  ).rejects.toThrow('imports');
});

test('untrusted previews cannot use a production resource through a PR-generated read-only facade', async () => {
  const config = releaseConfigurationSchema.parse({
    repository: policy.repository,
    appDirectory: 'app',
    productionUrl: 'https://example.org',
    previewUrl: 'https://preview.example.org',
    productionWorker: 'site',
    previewWorker: 'site-preview',
    artifactPrefix: 'site-release',
    artifactSource: 'typed-worker',
    typedConfig: 'cloudflare.config.ts',
    previewReadOnlyBindings: ['DATA'],
    stagingWorkflow: {
      name: 'Deploy staging',
      path: '.github/workflows/deploy.yml',
      branch: 'main',
    },
    promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote', branch: 'main' },
  });
  await expect(runIsolatedPrPreview(config, ['--action', 'publish'])).rejects.toThrow(
    'separate preview resources',
  );
});
