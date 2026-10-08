import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { workerReleaseEntry } from '../src/worker-release-entry.js';
import { isolatedPreviewBindings } from '../src/worker-bindings.js';

test('only an explicit shared R2 read-only capability can bypass the separate-preview bucket requirement', () => {
  const production = { DATA: { type: 'r2' as const, name: 'public-feed' } };
  expect(isolatedPreviewBindings(production, production, ['DATA'])).toEqual(production);
  expect(() => isolatedPreviewBindings(production, production)).toThrow('isolated');
  expect(() =>
    isolatedPreviewBindings(
      { DB: { type: 'd1', name: 'database', id: 'id' } },
      { DB: { type: 'd1', name: 'database', id: 'id' } },
      ['DB'],
    ),
  ).toThrow('read-only');
});

test('profile marker and shared R2 guard execute in fetch and Durable Objects while production retains its capability', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-entry-'));
  try {
    await writeFile(
      path.join(root, 'application.mjs'),
      `export class Gate {constructor(ctx,env){this.env=env} put(){return this.env.DATA.put('key','value')}}
      export default {async fetch(request,env){const path=new URL(request.url).pathname;if(path==='/read')return new Response(env.DATA.get());if(path==='/reflect-env'){Object.getOwnPropertyDescriptor(env,'DATA').value.put('key','value')}else if(path==='/reflect-bucket'){Object.getOwnPropertyDescriptor(env.DATA,'put').value('key','value')}else await env.DATA.put('key','value');return new Response('written')}}`,
    );
    const identity = { commit: 'a'.repeat(40), releaseId: '123', app: 'funding' };
    await writeFile(
      path.join(root, 'entry.mjs'),
      workerReleaseEntry('./application.mjs', identity, {
        publicPath: '/funding/',
        previewReadOnlyBindings: ['DATA'],
        durableExports: ['Gate'],
      }),
    );
    const entry = (await import(pathToFileURL(path.join(root, 'entry.mjs')).href)) as {
      default: { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
      Gate: new (ctx: unknown, env: unknown) => { put(): unknown };
    };
    let writes = 0;
    const env = {
      LVBT_DEPLOYMENT_ENV: 'preview',
      DATA: {
        put: () => {
          writes++;
        },
        get: () => 'feed',
      },
    };
    const marker = await entry.default.fetch(
      new Request('https://example.org/funding/lvbt-release.json'),
      env,
      {},
    );
    expect(await marker.json()).toEqual(identity);
    expect(marker.headers.get('x-robots-tag')).toContain('noindex');
    await expect(
      entry.default.fetch(new Request('https://example.org/funding/'), env, {}),
    ).rejects.toThrow('read-only');
    expect(() => new entry.Gate({}, env).put()).toThrow('read-only');
    for (const route of ['reflect-env', 'reflect-bucket'])
      await expect(
        entry.default.fetch(new Request(`https://example.org/${route}`), env, {}),
      ).rejects.toThrow();
    expect(writes).toBe(0);
    expect(
      await (await entry.default.fetch(new Request('https://example.org/read'), env, {})).text(),
    ).toBe('feed');
    await entry.default.fetch(
      new Request('https://example.org/funding/'),
      { ...env, LVBT_DEPLOYMENT_ENV: 'production' },
      {},
    );
    expect(writes).toBe(1);
    expect(await readFile(path.join(root, 'entry.mjs'), 'utf8')).toContain('export * from');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
