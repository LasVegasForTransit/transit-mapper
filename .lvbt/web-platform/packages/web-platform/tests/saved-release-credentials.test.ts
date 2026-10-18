import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import type { ReleaseConfiguration } from '../src/release-config.js';
import { packageRelease } from '../src/saved-release-artifact.js';
import { retainReleaseMigrations, runReleaseMigrations } from '../src/saved-release-migrations.js';

const expected = '1c4deaba-ee53-4c3f-ba65-176ae596cad5';
const config: ReleaseConfiguration = {
  repository: 'Example/app',
  appDirectory: 'apps/worker',
  productionWorker: 'app',
  previewWorker: 'app-preview',
  productionUrl: 'https://example.org',
  previewUrl: 'https://preview.example.org',
  artifactPrefix: 'app-release',
  migrations: [{ binding: 'DB', directory: 'migrations' }],
  stagingWorkflow: { name: 'Stage', path: '.github/workflows/stage.yml', branch: 'main' },
  promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote', branch: 'main' },
};
interface Invocation {
  args: string[];
  apiToken: string;
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-credentials-'));
  const source = path.join(root, 'apps/worker');
  const directory = path.join(root, 'release');
  const capture = path.join(root, 'calls.jsonl');
  for (const subtree of ['dist', '.wrangler/worker', 'migrations'])
    await mkdir(path.join(source, subtree), { recursive: true });
  await mkdir(path.join(root, 'bin'));
  await writeFile(path.join(source, 'dist/index.html'), '<main>Reviewed</main>');
  await writeFile(path.join(source, '.wrangler/worker/index.js'), 'export default {}');
  await writeFile(path.join(source, 'migrations/0001.sql'), 'CREATE TABLE fixture(id INTEGER);');
  await writeFile(
    path.join(source, 'wrangler.jsonc'),
    JSON.stringify({
      name: 'app',
      d1_databases: [{ binding: 'DB', database_id: 'production-db', migrations_dir: 'migrations' }],
      env: {
        preview: {
          d1_databases: [
            { binding: 'DB', database_id: 'preview-db', migrations_dir: 'migrations' },
          ],
        },
      },
    }),
  );
  await retainReleaseMigrations(source, source, config);
  await packageRelease(source, directory, { commit: 'a'.repeat(40), releaseId: '123' });
  await writeFile(
    path.join(root, 'bin/pnpm'),
    String.raw`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);
fs.appendFileSync(process.env.MIGRATION_CREDENTIAL_CAPTURE,JSON.stringify({args,apiToken:process.env.CLOUDFLARE_API_TOKEN})+'\n');
if(args[2]==='deployments'&&args[3]==='list') {
  process.stdout.write(JSON.stringify([{created_on:'2026-09-05T00:00:00Z',versions:[{version_id:process.env.MIGRATION_FIXTURE_VERSION,percentage:100}]}]));
} else if(args[2]!=='d1'||args[3]!=='migrations'||args[4]!=='apply') {
  throw new Error('Unexpected provider command');
}
`,
    { mode: 0o755 },
  );
  vi.stubEnv('PATH', `${path.join(root, 'bin')}:${process.env.PATH}`);
  vi.stubEnv('MIGRATION_CREDENTIAL_CAPTURE', capture);
  vi.stubEnv('MIGRATION_FIXTURE_VERSION', expected);
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'fixture-workers-token');
  vi.stubEnv('CLOUDFLARE_MIGRATIONS_API_TOKEN', 'fixture-d1-token');
  const calls = async (): Promise<Invocation[]> =>
    (await readFile(capture, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Invocation);
  return { root, directory, calls };
}
function argumentsFor(directory: string, target = 'production') {
  return [
    '--directory',
    directory,
    '--target',
    target,
    ...(target === 'production' ? ['--expected-version', expected] : []),
  ];
}

test.each(['production', 'preview'])(
  'only the %s D1 subprocess receives the migration API credential',
  async (target) => {
    const f = await fixture();
    try {
      await runReleaseMigrations(config, argumentsFor(f.directory, target));
      const calls = await f.calls();
      expect(calls.map(({ args, apiToken }) => [args[2], apiToken])).toEqual(
        target === 'production'
          ? [
              ['deployments', 'fixture-workers-token'],
              ['d1', 'fixture-d1-token'],
            ]
          : [['d1', 'fixture-d1-token']],
      );
      expect(calls.flatMap(({ args }) => args)).not.toContain('fixture-d1-token');
      expect(process.env.CLOUDFLARE_API_TOKEN).toBe('fixture-workers-token');
    } finally {
      vi.unstubAllEnvs();
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

test('a changed production version uses the Workers credential and prevents every D1 write', async () => {
  const f = await fixture();
  try {
    vi.stubEnv('MIGRATION_FIXTURE_VERSION', '2ae50b24-3d42-48d2-a784-627b60841961');
    await expect(runReleaseMigrations(config, argumentsFor(f.directory))).rejects.toThrow(
      /production version changed/,
    );
    const calls = await f.calls();
    expect(calls.map(({ args, apiToken }) => ({ args: args.slice(0, 4), apiToken }))).toEqual([
      { args: ['exec', 'wrangler', 'deployments', 'list'], apiToken: 'fixture-workers-token' },
    ]);
  } finally {
    vi.unstubAllEnvs();
    await rm(f.root, { recursive: true, force: true });
  }
});

test.each(['', '   '])(
  'an explicitly empty migration credential never falls back to Workers authority (%j)',
  async (credential) => {
    const f = await fixture();
    try {
      vi.stubEnv('CLOUDFLARE_MIGRATIONS_API_TOKEN', credential);
      await expect(runReleaseMigrations(config, argumentsFor(f.directory))).rejects.toThrow(
        /CLOUDFLARE_MIGRATIONS_API_TOKEN/,
      );
      expect((await f.calls()).map(({ args }) => args[2])).toEqual(['deployments']);
    } finally {
      vi.unstubAllEnvs();
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

test('legacy callers that omit the separate key retain their existing credential fallback', async () => {
  const f = await fixture();
  try {
    vi.stubEnv('CLOUDFLARE_MIGRATIONS_API_TOKEN', undefined);
    await runReleaseMigrations(config, argumentsFor(f.directory));
    expect((await f.calls()).map(({ args, apiToken }) => [args[2], apiToken])).toEqual([
      ['deployments', 'fixture-workers-token'],
      ['d1', 'fixture-workers-token'],
    ]);
  } finally {
    vi.unstubAllEnvs();
    await rm(f.root, { recursive: true, force: true });
  }
});
