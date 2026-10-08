import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import type { ReleaseConfiguration } from '../src/release-config.js';
import { packageRelease, sealSavedRelease, verifyRelease } from '../src/saved-release-artifact.js';
import { retainReleaseMigrations, runReleaseMigrations } from '../src/saved-release-migrations.js';

const config: ReleaseConfiguration = {
  repository: 'Example/app',
  appDirectory: 'apps/worker',
  productionWorker: 'app',
  previewWorker: 'app-preview',
  productionUrl: 'https://example.org',
  previewUrl: 'https://preview.example.org',
  artifactPrefix: 'app-release',
  migrations: [{ binding: 'DB', directory: '../site/migrations' }],
  stagingWorkflow: { name: 'Deploy staging', path: '.github/workflows/deploy.yml', branch: 'main' },
  promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote app', branch: 'main' },
};
const sql = Buffer.from('-- reviewed\r\nCREATE TABLE users(id INTEGER);\r\n');
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-migrations-'));
  const source = path.join(root, 'apps/worker');
  const directory = path.join(root, 'release');
  await mkdir(path.join(source, '.wrangler/worker'), { recursive: true });
  await mkdir(path.join(source, 'dist'), { recursive: true });
  await mkdir(path.join(root, 'apps/site/migrations'), { recursive: true });
  await writeFile(path.join(root, 'apps/site/migrations/0001_users.sql'), sql);
  await writeFile(path.join(source, 'dist/index.html'), '<main>Reviewed</main>');
  await writeFile(path.join(source, '.wrangler/worker/index.js'), 'export default {}');
  await writeFile(
    path.join(source, 'wrangler.jsonc'),
    JSON.stringify({
      name: 'app',
      d1_databases: [
        { binding: 'DB', database_id: 'production-db', migrations_dir: '../site/migrations' },
      ],
      env: {
        preview: {
          name: 'app-preview',
          d1_databases: [
            { binding: 'DB', database_id: 'preview-db', migrations_dir: '../site/migrations' },
          ],
        },
      },
    }),
  );
  const capture = path.join(root, 'capture.json');
  await mkdir(path.join(root, 'bin'));
  await writeFile(
    path.join(root, 'bin/pnpm'),
    String.raw`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),file=args[args.indexOf('--config')+1],config=JSON.parse(fs.readFileSync(file,'utf8'));
const env=args[args.indexOf('--env')+1],db=(env==='preview'?config.env.preview:config).d1_databases.find(x=>x.binding===args[5]);
fs.writeFileSync(process.env.MIGRATION_CAPTURE,JSON.stringify({args,file,db,sql:fs.readFileSync(path.resolve(path.dirname(file),db.migrations_dir,'0001_users.sql'),'base64'),ci:process.env.CI}));
fs.writeFileSync(path.join(path.dirname(file),'wrangler-cache'),'temporary only');
if(process.env.MIGRATION_FAIL==='true')process.exit(1);
`,
    { mode: 0o755 },
  );
  vi.stubEnv('PATH', `${path.join(root, 'bin')}:${process.env.PATH}`);
  vi.stubEnv('MIGRATION_CAPTURE', capture);
  return { root, source, directory, capture };
}
async function seal(source: string, directory: string) {
  await retainReleaseMigrations(source, source, config);
  return await packageRelease(source, directory, { commit: 'a'.repeat(40), releaseId: '123' });
}

test.each(['preview', 'production'])(
  'migrates %s from sealed SQL and isolated saved binding, never changed checkout inputs',
  async (target) => {
    const f = await fixture();
    try {
      const release = await seal(f.source, f.directory);
      await writeFile(
        path.join(f.root, 'apps/site/migrations/0001_users.sql'),
        'DROP TABLE users;',
      );
      await writeFile(path.join(f.source, 'wrangler.jsonc'), '{}');
      const current = { ...config };
      delete current.migrations;
      await runReleaseMigrations(current, [
        '--directory',
        f.directory,
        '--target',
        target,
        '--commit',
        release.commit,
        '--release-id',
        release.releaseId,
      ]);
      const result = JSON.parse(await readFile(f.capture, 'utf8')) as {
        args: string[];
        file: string;
        db: { database_id: string };
        sql: string;
        ci: string;
      };
      expect(result.args.slice(0, 6)).toEqual([
        'exec',
        'wrangler',
        'd1',
        'migrations',
        'apply',
        'DB',
      ]);
      expect(result.args).toContain('--remote');
      expect(result.args[result.args.indexOf('--env') + 1]).toBe(
        target === 'preview' ? 'preview' : '',
      );
      expect(result.db.database_id).toBe(target === 'preview' ? 'preview-db' : 'production-db');
      expect(result.sql).toBe(sql.toString('base64'));
      expect(result.ci).toBe('true');
      expect(result.file.startsWith(f.directory)).toBe(false);
      expect(await verifyRelease(f.directory)).toEqual(release);
      await expect(readFile(result.file)).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

test('SQL tampering and mismatched release provenance fail before a provider command', async () => {
  const f = await fixture();
  try {
    await seal(f.source, f.directory);
    await expect(
      runReleaseMigrations(config, [
        '--directory',
        f.directory,
        '--target',
        'production',
        '--commit',
        'b'.repeat(40),
      ]),
    ).rejects.toThrow('commit');
    await writeFile(
      path.join(f.directory, '.wrangler/worker/migrations/DB/0001_users.sql'),
      'DROP TABLE users;',
    );
    await expect(
      runReleaseMigrations(config, ['--directory', f.directory, '--target', 'preview']),
    ).rejects.toThrow();
    await expect(readFile(f.capture)).rejects.toThrow();
  } finally {
    vi.unstubAllEnvs();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('missing frozen SQL in a new artifact never falls back to current migration source', async () => {
  const f = await fixture();
  try {
    await packageRelease(
      f.source,
      f.directory,
      { commit: 'a'.repeat(40), releaseId: '123' },
      { formatVersion: 2 },
    );
    await expect(
      runReleaseMigrations(config, ['--directory', f.directory, '--target', 'preview']),
    ).rejects.toThrow('saved migrations');
    await expect(readFile(f.capture)).rejects.toThrow();
  } finally {
    vi.unstubAllEnvs();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('original v1 releases preserve their no-migration behavior even when current declarations include SQL', async () => {
  const f = await fixture();
  try {
    const release = await packageRelease(f.source, f.directory, {
      commit: 'a'.repeat(40),
      releaseId: '123',
    });
    expect(release.formatVersion).toBe(1);
    await writeFile(path.join(f.root, 'apps/site/migrations/0001_users.sql'), 'DROP TABLE users;');
    await runReleaseMigrations(config, ['--directory', f.directory, '--target', 'production']);
    await expect(readFile(f.capture)).rejects.toThrow();
    expect(await verifyRelease(f.directory)).toEqual(release);
  } finally {
    vi.unstubAllEnvs();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('verified legacy releases without declared migrations succeed without provider calls', async () => {
  const f = await fixture();
  try {
    await packageRelease(f.source, f.directory, { commit: 'a'.repeat(40), releaseId: '123' });
    const current = { ...config };
    delete current.migrations;
    await runReleaseMigrations(current, ['--directory', f.directory, '--target', 'production']);
    await expect(readFile(f.capture)).rejects.toThrow();
  } finally {
    vi.unstubAllEnvs();
    await rm(f.root, { recursive: true, force: true });
  }
});

test.each(['outside', 'symlink', 'empty', 'missing', 'duplicate', 'unknown'])(
  'rejects %s migration declarations before packaging',
  async (mode) => {
    const f = await fixture();
    try {
      let migrations = config.migrations;
      if (mode === 'outside') migrations = [{ binding: 'DB', directory: '../../../' }];
      if (mode === 'symlink') {
        await rm(path.join(f.root, 'apps/site/migrations/0001_users.sql'));
        await symlink(
          path.join(f.source, 'dist/index.html'),
          path.join(f.root, 'apps/site/migrations/0001_users.sql'),
        );
      }
      if (mode === 'empty') await rm(path.join(f.root, 'apps/site/migrations/0001_users.sql'));
      if (mode === 'missing') migrations = [{ binding: 'DB', directory: './missing' }];
      if (mode === 'duplicate')
        migrations = [...(config.migrations ?? []), ...(config.migrations ?? [])];
      if (mode === 'unknown')
        migrations = [{ binding: 'UNKNOWN', directory: '../site/migrations' }];
      await expect(
        retainReleaseMigrations(f.source, f.source, { ...config, migrations }),
      ).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

test('provider failures propagate and leave sealed artifacts unchanged', async () => {
  const f = await fixture();
  try {
    const release = await seal(f.source, f.directory);
    vi.stubEnv('MIGRATION_FAIL', 'true');
    await expect(
      runReleaseMigrations(config, ['--directory', f.directory, '--target', 'preview']),
    ).rejects.toThrow();
    expect(await verifyRelease(f.directory)).toEqual(release);
  } finally {
    vi.unstubAllEnvs();
    await rm(f.root, { recursive: true, force: true });
  }
});

test.each(['shared-database', 'escaped-path', 'missing-inventory', 'wrong-worker'])(
  'rejects sealed %s configuration before migration execution',
  async (mode) => {
    const f = await fixture();
    try {
      await seal(f.source, f.directory);
      const file = path.join(f.directory, 'wrangler.jsonc');
      const saved = JSON.parse(await readFile(file, 'utf8')) as {
        name: string;
        env: { preview: { d1_databases: Array<{ database_id: string; migrations_dir: string }> } };
      };
      const database = saved.env.preview.d1_databases[0];
      if (!database) throw new Error('Fixture needs its preview database.');
      if (mode === 'shared-database') database.database_id = 'production-db';
      if (mode === 'escaped-path') database.migrations_dir = '../checkout/migrations';
      if (mode === 'wrong-worker') saved.name = 'different-app';
      if (mode === 'missing-inventory')
        await rm(path.join(f.directory, '.wrangler/worker/migrations/DB/0001_users.sql'));
      await writeFile(file, JSON.stringify(saved));
      await rm(path.join(f.directory, 'release.json'));
      await sealSavedRelease(f.directory, { commit: 'a'.repeat(40), releaseId: '123' });
      await expect(
        runReleaseMigrations(config, ['--directory', f.directory, '--target', 'preview']),
      ).rejects.toThrow();
      await expect(readFile(f.capture)).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

test('a changed production baseline prevents SQL, candidate upload, and activation before any provider write', async () => {
  const { runWorkerRelease } = await import('../src/worker-release-command.js');
  const f = await fixture();
  try {
    await seal(f.source, f.directory);
    const requests = path.join(f.root, 'requests.jsonl');
    vi.stubEnv('VERSION_GUARD_CAPTURE', requests);
    await writeFile(
      path.join(f.root, 'bin/pnpm'),
      `#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);
fs.appendFileSync(process.env.VERSION_GUARD_CAPTURE,JSON.stringify(args)+'\\n');
if(args[2]!=='deployments'||args[3]!=='list')throw new Error('A production write was attempted');
process.stdout.write(JSON.stringify([{created_on:'2026-09-05T00:00:00Z',versions:[{version_id:'2ae50b24-3d42-48d2-a784-627b60841961',percentage:100}]}]));
`,
      { mode: 0o755 },
    );
    const guarded = [
      '--directory',
      f.directory,
      '--target',
      'production',
      '--expected-version',
      '1c4deaba-ee53-4c3f-ba65-176ae596cad5',
    ];
    await expect(runReleaseMigrations(config, guarded)).rejects.toThrow(
      /production version changed/,
    );
    await expect(runWorkerRelease(config, ['upload', ...guarded])).rejects.toThrow(
      /production version changed/,
    );
    await expect(
      runWorkerRelease(config, [
        'activate',
        ...guarded,
        '--version',
        '1c4deaba-ee53-4c3f-ba65-176ae596cad5',
      ]),
    ).rejects.toThrow(/production version changed/);
    const commands = (await readFile(requests, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    expect(commands).toHaveLength(3);
    expect(commands.every((args) => args[2] === 'deployments' && args[3] === 'list')).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    await rm(f.root, { recursive: true, force: true });
  }
});
