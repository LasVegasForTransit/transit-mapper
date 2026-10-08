import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { runWorkerRelease } from '../src/worker-release-command.js';
import { packageRelease, verifyRelease } from '../src/saved-release-artifact.js';
import { namedDeployReceipt, verifyNamedPreview } from '../src/named-worker-release.js';
const identity = { commit: 'a'.repeat(40), releaseId: '123' };
const version = '12345678-1234-4234-8234-123456789abc';
const config = {
  repository: 'Example/app',
  appDirectory: 'app',
  publicationMode: 'named-staging' as const,
  productionWorker: 'app',
  previewWorker: 'app-preview',
  productionUrl: 'https://example.org',
  previewUrl: 'https://preview.example.org',
  artifactPrefix: 'app-release',
  workersDevSubdomain: 'example',
  stagingWorkflow: { name: 'Deploy staging', path: '.github/workflows/deploy.yml', branch: 'main' },
  promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote app', branch: 'main' },
};
async function fixture(root: string) {
  const source = path.join(root, 'app');
  await mkdir(path.join(source, 'dist'), { recursive: true });
  await mkdir(path.join(source, '.wrangler/worker'), { recursive: true });
  await writeFile(path.join(source, 'dist/index.html'), '<main>Reviewed</main>');
  await writeFile(path.join(source, '.wrangler/worker/index.js'), 'export default {}');
  await writeFile(
    path.join(source, 'wrangler.jsonc'),
    JSON.stringify({
      name: 'app',
      logpush: true,
      env: { preview: { name: 'app-preview', logpush: true } },
    }),
  );
  const directory = path.join(root, 'release');
  const release = await packageRelease(source, directory, identity, { formatVersion: 2 });
  await mkdir(path.join(root, 'bin'));
  await writeFile(
    path.join(root, 'bin/pnpm'),
    String.raw`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2),file=args[args.indexOf('--config')+1];
fs.appendFileSync(process.env.RELEASE_CAPTURE_PATH,JSON.stringify({args,config:JSON.parse(fs.readFileSync(file,'utf8'))})+'\n');
fs.writeFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH,JSON.stringify({type:'deploy',version:1,worker_name:args[args.indexOf('--name')+1],version_id:'12345678-1234-4234-8234-123456789abc'}));
fs.writeFileSync(file,'modified working copy');`,
    { mode: 0o755 },
  );
  return { directory, release };
}
test('named candidate writes only staging, production activation rechecks identity, and both deploy retained copies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'named-release-'));
  try {
    const { directory, release } = await fixture(root);
    const capture = path.join(root, 'calls.jsonl');
    vi.stubEnv('PATH', `${path.join(root, 'bin')}:${process.env.PATH}`);
    vi.stubEnv('RELEASE_CAPTURE_PATH', capture);
    vi.stubEnv('CF_ACCESS_CLIENT_ID', 'test-id');
    vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'test-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: { headers: Record<string, string> }) =>
        options.headers['CF-Access-Client-Id']
          ? Response.json(identity)
          : new Response('', { status: 403 }),
      ),
    );
    await runWorkerRelease(config, ['upload', '--directory', directory, '--target', 'production']);
    await runWorkerRelease(config, [
      'activate',
      '--directory',
      directory,
      '--target',
      'production',
      '--version',
      version,
    ]);
    const calls = (await readFile(capture, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { args: string[]; config: unknown });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        'deploy',
        '--name',
        'app-preview',
        '--env',
        'preview',
        '--no-bundle',
      ]),
    );
    expect(calls[1]?.args).toEqual(
      expect.arrayContaining(['deploy', '--name', 'app', '--no-bundle']),
    );
    expect(calls[1]?.config).toMatchObject({ logpush: true });
    expect(await verifyRelease(directory)).toEqual(release);
    await expect(
      runWorkerRelease({ ...config, previewOnly: true }, [
        'upload',
        '--directory',
        directory,
        '--target',
        'production',
      ]),
    ).rejects.toThrow('Preview-only');
    expect((await readFile(capture, 'utf8')).trim().split('\n')).toHaveLength(2);
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  }
});
test('named receipts reject missing, duplicate, or unrelated namespaces without inventing a version URL', () => {
  const receipt = { type: 'deploy', version: 1, worker_name: 'app-preview', version_id: version };
  expect(namedDeployReceipt(JSON.stringify(receipt), 'app-preview')).toEqual({ version });
  expect(() => namedDeployReceipt(JSON.stringify(receipt), 'app')).toThrow('reconcile');
  expect(() =>
    namedDeployReceipt(`${JSON.stringify(receipt)}\n${JSON.stringify(receipt)}`, 'app-preview'),
  ).toThrow('reconcile');
});
test('direct named activation verification rejects a namesake in another account before using credentials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'named-account-'));
  try {
    const { release } = await fixture(root);
    vi.stubEnv('CF_ACCESS_CLIENT_ID', 'test-id');
    vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'test-secret');
    const fetch = vi.fn(() => Response.json(identity));
    vi.stubGlobal('fetch', fetch);
    await expect(
      verifyNamedPreview(
        { ...config, previewUrl: 'https://app-preview.foreign-account.workers.dev' },
        release,
      ),
    ).rejects.toThrow('reviewed Worker');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  }
});
