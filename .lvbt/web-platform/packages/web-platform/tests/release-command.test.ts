import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { packageRelease, verifyRelease } from '../src/saved-release-artifact.js';
const execute = promisify(execFile);
const entry = fileURLToPath(new URL('../src/release-command.ts', import.meta.url));
const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
const config = {
  repository: 'Example/app',
  appDirectory: 'app',
  productionUrl: 'https://example.org',
  previewUrl: 'https://preview.example.org',
  productionWorker: 'app',
  previewWorker: 'app-preview',
  artifactPrefix: 'app-release',
  workersDevSubdomain: 'example',
  stagingWorkflow: {
    name: 'Deploy staging',
    path: '.github/workflows/deploy-production.yml',
    branch: 'main',
  },
  promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote app', branch: 'main' },
};
test('activation uses retained Worker settings and cannot mutate the saved artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shared-release-activation-'));
  try {
    await mkdir(path.join(root, '.lvbt'));
    await mkdir(path.join(root, 'app/dist'), { recursive: true });
    await mkdir(path.join(root, 'app/.wrangler/worker'), { recursive: true });
    await writeFile(
      path.join(root, '.lvbt/tooling.json'),
      JSON.stringify({ version: 1, release: config }),
    );
    await writeFile(path.join(root, 'app/dist/index.html'), '<main>Retained release</main>');
    await writeFile(path.join(root, 'app/.wrangler/worker/index.js'), 'export default {}');
    const retained = {
      name: 'app',
      observability: { enabled: true },
      logpush: true,
      tail_consumers: [{ service: 'retained-tail' }],
      env: {
        preview: {
          name: 'app-preview',
          observability: { enabled: true },
          logpush: true,
          tail_consumers: [{ service: 'retained-preview-tail' }],
        },
      },
    };
    await writeFile(path.join(root, 'app/wrangler.jsonc'), JSON.stringify(retained));
    const directory = path.join(root, 'release');
    const saved = await packageRelease(path.join(root, 'app'), directory, {
      commit: 'a'.repeat(40),
      releaseId: '123',
    });
    await writeFile(
      path.join(root, 'app/wrangler.jsonc'),
      JSON.stringify({
        ...retained,
        observability: { enabled: false },
        logpush: false,
        tail_consumers: [],
      }),
    );
    await mkdir(path.join(root, 'bin'));
    const capture = path.join(root, 'activation.json');
    await writeFile(
      path.join(root, 'bin/pnpm'),
      String.raw`#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
const index=args.indexOf('--config');
const config=index<0?'wrangler.jsonc':args[index+1];
fs.writeFileSync(process.env.RELEASE_CAPTURE_PATH,JSON.stringify({args,config:JSON.parse(fs.readFileSync(config,'utf8'))}));
fs.writeFileSync(config,'Wrangler wrote to its working copy');
`,
      { mode: 0o755 },
    );
    await execute(
      tsx,
      [
        entry,
        'worker-release',
        root,
        'activate',
        '--directory',
        directory,
        '--target',
        'preview',
        '--version',
        '12345678-1234-1234-1234-123456789abc',
        '--commit',
        'a'.repeat(40),
        '--release-id',
        '123',
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
          RELEASE_CAPTURE_PATH: capture,
        },
      },
    );
    const activated = JSON.parse(await readFile(capture, 'utf8')) as {
      config: unknown;
      args: string[];
    };
    expect(activated.config).toEqual(retained);
    expect(activated.args).toEqual(
      expect.arrayContaining(['--name', 'app-preview', '--env', 'preview', '--config']),
    );
    expect(await verifyRelease(directory)).toEqual(saved);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('the shared release runner seals and verifies a consumer build without rebuilding it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shared-release-command-'));
  try {
    await mkdir(path.join(root, '.lvbt'));
    await mkdir(path.join(root, 'app/dist'), { recursive: true });
    await mkdir(path.join(root, 'app/.wrangler/worker'), { recursive: true });
    await writeFile(
      path.join(root, '.lvbt/tooling.json'),
      JSON.stringify({ version: 1, release: config }),
    );
    await writeFile(path.join(root, 'app/dist/index.html'), '<h1>Saved app</h1>');
    await writeFile(path.join(root, 'app/.wrangler/worker/index.js'), 'export default {}');
    await writeFile(
      path.join(root, 'app/wrangler.jsonc'),
      '{"name":"app","env":{"preview":{"name":"app-preview"}}}',
    );
    const directory = path.join(root, 'release');
    const packed = await execute(
      tsx,
      [
        entry,
        'worker-release',
        root,
        'package',
        '--directory',
        directory,
        '--commit',
        'a'.repeat(40),
        '--release-id',
        '123',
      ],
      { cwd: root },
    );
    const verified = await execute(
      tsx,
      [
        entry,
        'worker-release',
        root,
        'verify',
        '--directory',
        directory,
        '--commit',
        'a'.repeat(40),
        '--release-id',
        '123',
      ],
      { cwd: root },
    );
    expect(JSON.parse(verified.stdout)).toEqual(JSON.parse(packed.stdout));
    expect(await readFile(path.join(directory, 'dist/index.html'), 'utf8')).toBe(
      '<h1>Saved app</h1>',
    );

    const bin = path.join(root, 'bin');
    await mkdir(bin);
    const capture = path.join(root, 'upload-args.json');
    await writeFile(
      path.join(bin, 'pnpm'),
      String.raw`#!/usr/bin/env node
const fs=require('node:fs');
fs.writeFileSync(process.env.RELEASE_CAPTURE_PATH,JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH,JSON.stringify({type:'version-upload',version:1,worker_name:'app-preview',version_id:'12345678-1234-1234-1234-123456789abc',preview_url:'https://12345678-app-preview.example.workers.dev'})+'\n');
`,
      { mode: 0o755 },
    );
    const uploaded = await execute(
      tsx,
      [entry, 'worker-release', root, 'upload', '--directory', directory, '--target', 'preview'],
      {
        cwd: root,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RELEASE_CAPTURE_PATH: capture },
      },
    );
    expect(JSON.parse(uploaded.stdout)).toMatchObject({
      version: '12345678-1234-1234-1234-123456789abc',
      releaseId: '123',
    });
    const uploadedArgs: unknown = JSON.parse(await readFile(capture, 'utf8'));
    expect(uploadedArgs).toEqual(
      expect.arrayContaining(['--name', 'app-preview', '--env', 'preview', '--no-bundle']),
    );
    const unchanged = await execute(
      tsx,
      [entry, 'worker-release', root, 'verify', '--directory', directory],
      { cwd: root },
    );
    expect(JSON.parse(unchanged.stdout)).toEqual(JSON.parse(packed.stdout));

    await expect(
      execute(
        tsx,
        [
          entry,
          'worker-release',
          root,
          'verify',
          '--directory',
          directory,
          '--commit',
          'b'.repeat(40),
        ],
        { cwd: root },
      ),
    ).rejects.toThrow('does not match');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
