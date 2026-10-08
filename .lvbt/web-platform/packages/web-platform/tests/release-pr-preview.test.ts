import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { packageTypedWorkerRelease } from '../src/typed-worker-release-artifact.js';
import type { runReleaseMigrations } from '../src/saved-release-migrations.js';
import type { deployNamedSavedRelease } from '../src/named-worker-release.js';
import type { verifyWorkerReleaseSmoke } from '../src/worker-release-smoke.js';
import type { runWorkerPreview } from '../src/worker-preview-command.js';
import { sealSavedRelease, verifyRelease } from '../src/saved-release-artifact.js';
import { prPreviewConfiguration, runPrPreview } from '../src/release-pr-preview-command.js';

const calls = vi.hoisted(() => ({
  package: vi.fn<typeof packageTypedWorkerRelease>(),
  migrate: vi.fn<typeof runReleaseMigrations>(),
  deploy: vi.fn<typeof deployNamedSavedRelease>(),
  smoke: vi.fn<typeof verifyWorkerReleaseSmoke>(),
  version: vi.fn<typeof runWorkerPreview>(),
}));
vi.mock('../src/typed-worker-release-artifact.js', () => ({
  packageTypedWorkerRelease: calls.package,
}));
vi.mock('../src/saved-release-migrations.js', () => ({ runReleaseMigrations: calls.migrate }));
vi.mock('../src/named-worker-release.js', () => ({ deployNamedSavedRelease: calls.deploy }));
vi.mock('../src/worker-preview-command.js', () => ({ runWorkerPreview: calls.version }));
vi.mock('../src/worker-release-smoke.js', async (original) => ({
  ...(await original<object>()),
  verifyWorkerReleaseSmoke: calls.smoke,
}));
const config = {
  repository: 'Example/app',
  appDirectory: 'app',
  productionWorker: 'app',
  previewWorker: 'app-preview',
  productionUrl: 'https://example.org',
  previewUrl: 'https://preview.example.org',
  workersDevSubdomain: 'reviewed-account',
  artifactSource: 'typed-worker' as const,
  typedConfig: 'cloudflare.config.ts',
  publicationMode: 'named-staging' as const,
  artifactPrefix: 'app-release',
  smoke: { path: '/', status: 200 },
  stagingWorkflow: { name: 'Staging', path: '.github/workflows/deploy.yml', branch: 'main' },
  promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote', branch: 'main' },
};
const args = [
  '--pr',
  '42',
  '--commit',
  'a'.repeat(40),
  '--release-id',
  '123',
  '--publication-mode',
  'named-staging',
  '--protection',
  'public',
];
let eventRoot: string;
beforeEach(async () => {
  eventRoot = await mkdtemp(path.join(os.tmpdir(), 'pr-event-'));
  const event = path.join(eventRoot, 'event.json');
  await writeFile(
    event,
    JSON.stringify({
      action: 'synchronize',
      number: 42,
      pull_request: {
        head: { repo: { full_name: config.repository } },
        base: { ref: 'main', repo: { full_name: config.repository } },
      },
    }),
  );
  for (const [name, value] of Object.entries({
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: event,
    GITHUB_REPOSITORY: config.repository,
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_RUN_ID: '123',
  }))
    vi.stubEnv(name, value);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  await rm(eventRoot, { recursive: true, force: true });
});

function packagedFixture() {
  calls.package.mockImplementation(
    async (
      _source: string,
      destination: string,
      identity: { commit: string; releaseId: string },
    ) => {
      await mkdir(path.join(destination, '.wrangler/worker'), { recursive: true });
      await writeFile(path.join(destination, '.wrangler/worker/index.js'), 'export default {}');
      await writeFile(path.join(destination, 'lvbt-release.json'), JSON.stringify(identity));
      await writeFile(
        path.join(destination, 'wrangler.jsonc'),
        JSON.stringify({
          name: 'app',
          routes: [{ pattern: 'example.org', custom_domain: true }],
          d1_databases: [{ binding: 'DB', database_id: 'production' }],
          durable_objects: { bindings: [{ name: 'ROOM', class_name: 'Room' }] },
          env: {
            preview: {
              name: 'app-preview',
              routes: [{ pattern: 'preview.example.org', custom_domain: true }],
              d1_databases: [{ binding: 'DB', database_id: 'isolated-preview' }],
              durable_objects: {
                bindings: [{ name: 'ROOM', class_name: 'Room', script_name: 'app-preview' }],
              },
              triggers: { crons: [] },
            },
          },
        }),
      );
      return await sealSavedRelease(destination, identity, 'worker', 2);
    },
  );
  calls.deploy.mockResolvedValue({ version: '12345678-1234-4234-8234-123456789abc' });
  calls.smoke.mockImplementation(({ origin, smoke, identity }) =>
    Promise.resolve({ origin, path: smoke.path, identity }),
  );
}

test('named PR deployment retains preview data, removes routes, retargets DOs, and destroys its private artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pr-preview-test-'));
  try {
    packagedFixture();
    vi.stubEnv('GITHUB_OUTPUT', path.join(root, 'output'));
    vi.stubEnv('CF_ACCESS_CLIENT_ID', 'must-not-transfer');
    vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'must-not-transfer');
    calls.deploy.mockImplementation(async (selected, directory, release, target) => {
      expect(target).toBe('preview');
      expect(selected.previewWorker).toBe('app-pr-42');
      expect((await verifyRelease(directory)).artifactHash).toBe(release.artifactHash);
      const saved: unknown = JSON.parse(
        await readFile(path.join(directory, 'wrangler.jsonc'), 'utf8'),
      );
      expect(saved).toMatchObject({
        env: {
          preview: {
            name: 'app-pr-42',
            routes: [],
            workers_dev: true,
            d1_databases: [{ binding: 'DB', database_id: 'isolated-preview' }],
            durable_objects: { bindings: [{ script_name: 'app-pr-42' }] },
            triggers: { crons: [] },
          },
        },
      });
      return { version: '12345678-1234-4234-8234-123456789abc' };
    });
    await runPrPreview(config, args);
    expect(calls.migrate.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(['--target', 'preview']),
    );
    expect(calls.smoke.mock.calls[0]?.[0]).toMatchObject({
      origin: 'https://app-pr-42.reviewed-account.workers.dev',
      protected: false,
    });
    expect(calls.smoke.mock.calls[0]?.[0].credentials).toBeUndefined();
    const directory = calls.deploy.mock.calls[0]?.[1];
    if (!directory) throw new Error('No deploy fixture directory.');
    await expect(access(directory)).rejects.toThrow();
    const output = await readFile(path.join(root, 'output'), 'utf8');
    expect(output).toContain('url=https://app-pr-42.reviewed-account.workers.dev');
    expect(output).not.toMatch(/artifact-hash|directory=|attestation|candidate/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unsafe or unsupported PR inputs fail before packaging or provider operations', async () => {
  for (const invalid of ['0', '../production', '1\nurl=https://evil.example'])
    expect(() => prPreviewConfiguration(config, invalid)).toThrow();
  expect(() =>
    prPreviewConfiguration({ ...config, workersDevSubdomain: undefined }, '42'),
  ).toThrow();
  await expect(runPrPreview(config, [...args, '--target', 'production'])).rejects.toThrow();
  await expect(runPrPreview(config, [...args, '--secrets'])).rejects.toThrow();
  await expect(runPrPreview({ ...config, artifactSource: 'cf-output' }, args)).rejects.toThrow(
    'typed',
  );
  expect(calls.package).not.toHaveBeenCalled();
  expect(calls.deploy).not.toHaveBeenCalled();
});

test('protected PR checks anonymous denial before migrations or deploy and failures remove private files', async () => {
  packagedFixture();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Response('', { status: 200 })),
  );
  vi.stubEnv('CF_ACCESS_CLIENT_ID', 'id');
  vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'secret');
  await expect(
    runPrPreview(
      config,
      args.map((value) => (value === 'public' ? 'access' : value)),
    ),
  ).rejects.toThrow('Anonymous');
  expect(calls.package).not.toHaveBeenCalled();
  expect(calls.migrate).not.toHaveBeenCalled();
  expect(calls.deploy).not.toHaveBeenCalled();
});

test('a failed migration never deploys and deletes the packaged artifact', async () => {
  packagedFixture();
  calls.migrate.mockRejectedValue(new Error('reconcile applied migrations'));
  await expect(runPrPreview(config, args)).rejects.toThrow('reconcile');
  expect(calls.deploy).not.toHaveBeenCalled();
  const directory = calls.package.mock.calls[0]?.[1];
  if (!directory) throw new Error('No package fixture directory.');
  await expect(access(directory)).rejects.toThrow();
});

test('forks, target events, mismatched run identity and PR numbers cannot package or mutate', async () => {
  packagedFixture();
  vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request_target');
  await expect(runPrPreview(config, args)).rejects.toThrow('matching GitHub');
  vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request');
  vi.stubEnv('GITHUB_SHA', 'b'.repeat(40));
  await expect(runPrPreview(config, args)).rejects.toThrow('matching GitHub');
  vi.stubEnv('GITHUB_SHA', 'a'.repeat(40));
  await expect(
    runPrPreview(
      config,
      args.map((value) => (value === '42' ? '43' : value)),
    ),
  ).rejects.toThrow('trusted event');
  await writeFile(
    path.join(eventRoot, 'event.json'),
    JSON.stringify({
      action: 'synchronize',
      number: 42,
      pull_request: {
        head: { repo: { full_name: 'Attacker/fork' } },
        base: { ref: 'main', repo: { full_name: config.repository } },
      },
    }),
  );
  await expect(runPrPreview(config, args)).rejects.toThrow();
  expect(calls.package).not.toHaveBeenCalled();
  expect(calls.migrate).not.toHaveBeenCalled();
  expect(calls.deploy).not.toHaveBeenCalled();
});

test('PR origin resolution supports build-time URLs without provider operations', async () => {
  const output = path.join(eventRoot, 'output');
  vi.stubEnv('GITHUB_OUTPUT', output);
  await runPrPreview(config, [...args, '--action', 'resolve']);
  expect(await readFile(output, 'utf8')).toBe(
    'url=https://app-pr-42.reviewed-account.workers.dev\n',
  );
  expect(calls.package).not.toHaveBeenCalled();
  expect(calls.migrate).not.toHaveBeenCalled();
  expect(calls.deploy).not.toHaveBeenCalled();
});

test('version aliases always use the preview environment without secret writes or activation', async () => {
  await runPrPreview(
    { ...config, publicationMode: 'version' },
    args.map((value) => (value === 'named-staging' ? 'version' : value)),
  );
  expect(calls.version).toHaveBeenCalledWith(expect.anything(), [
    '--alias',
    'pr-42',
    '--env',
    'preview',
    '--message',
    `PR #42 at ${'a'.repeat(40)}`,
  ]);
  expect(calls.package).not.toHaveBeenCalled();
  expect(calls.migrate).not.toHaveBeenCalled();
  expect(calls.deploy).not.toHaveBeenCalled();
});
