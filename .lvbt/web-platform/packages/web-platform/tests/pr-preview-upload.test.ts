import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { uploadPreview } from '../src/pr-preview-upload.ts';

test.each([
  { account_id: 'other' },
  { vars: { PUBLIC_LVBT_CWA_TOKEN: 'production-token' } },
  { workers_dev: true },
  { preview_urls: false },
])('refuses unsafe preview configuration before provider writes: %j', async (override) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-upload-'));
  let writes = 0;
  try {
    await writeFile(
      path.join(root, 'wrangler.json'),
      JSON.stringify({
        name: 'lvbt-labs-home',
        compatibility_date: '2026-08-31',
        assets: { directory: path.join(root, 'assets') },
        routes: [],
        workers_dev: false,
        preview_urls: true,
        ...override,
      }),
    );
    await expect(
      uploadPreview(
        {
          directory: root,
          worker: 'lvbt-labs-home',
          mode: 'version',
          repository: 'example/labs',
          pullRequest: 2,
          commit: 'a'.repeat(40),
          accountId: 'account',
        },
        {
          list: () => Promise.resolve([]),
          get: () => Promise.resolve(null),
        },
        () => {
          writes += 1;
          return Promise.resolve();
        },
      ),
    ).rejects.toThrow(/configuration/);
    expect(writes).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each([false, true])(
  'version upload leaves production untouched, changed=%s',
  async (changed) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'preview-upload-'));
    const version = '12345678-1234-4234-8234-123456789abc';
    let uploaded = false;
    const argsSeen: string[][] = [];
    try {
      await writeFile(
        path.join(root, 'wrangler.json'),
        JSON.stringify({
          name: 'lvbt-labs-home',
          compatibility_date: '2026-08-31',
          assets: { directory: path.join(root, 'assets') },
          routes: [],
          workers_dev: false,
          preview_urls: true,
        }),
      );
      const operation = uploadPreview(
        {
          directory: root,
          worker: 'lvbt-labs-home',
          mode: 'version',
          repository: 'example/labs',
          pullRequest: 2,
          commit: 'a'.repeat(40),
          accountId: 'account',
        },
        {
          list: () => Promise.resolve([{ id: 'lvbt-labs-home' }]),
          get: (endpoint) =>
            Promise.resolve(
              endpoint.endsWith('/deployments')
                ? {
                    deployments: [
                      {
                        created_on: '2026-09-05T00:00:00Z',
                        versions: [
                          {
                            version_id:
                              changed && uploaded
                                ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                                : version,
                            percentage: 100,
                          },
                        ],
                      },
                    ],
                  }
                : { resources: { bindings: [] } },
            ),
        },
        async (args, output) => {
          argsSeen.push(args);
          uploaded = true;
          await writeFile(
            output,
            JSON.stringify({
              type: 'version-upload',
              version: 1,
              worker_name: 'lvbt-labs-home',
              version_id: version,
              preview_url: `https://12345678-lvbt-labs-home.example.workers.dev`,
            }),
          );
        },
      );
      if (changed) await expect(operation).rejects.toThrow(/production deployment/);
      else expect((await operation).version).toBe(version);
      expect(argsSeen[0]?.slice(0, 2)).toEqual(['versions', 'upload']);
      expect(argsSeen[0]).not.toContain('deploy');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('deploys an existing isolated staging Worker and verifies its active version', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-upload-'));
  const previous = '12345678-1234-4234-8234-123456789abc';
  const deployed = '87654321-4321-4321-8321-cba987654321';
  let active = previous;
  const argsSeen: string[][] = [];
  try {
    await writeFile(
      path.join(root, 'wrangler.json'),
      JSON.stringify({
        name: 'lvbt-labs-map-staging',
        main: './src/worker.ts',
        compatibility_date: '2026-08-31',
        assets: { directory: path.join(root, 'assets') },
        durable_objects: { bindings: [{ name: 'MAP', class_name: 'MapState' }] },
        routes: [],
        workers_dev: true,
        preview_urls: false,
        vars: { DEPLOYMENT_ENVIRONMENT: 'staging' },
      }),
    );

    const receipt = await uploadPreview(
      {
        directory: root,
        worker: 'lvbt-labs-map-staging',
        mode: 'staging',
        repository: 'example/labs',
        pullRequest: 2,
        commit: 'a'.repeat(40),
        accountId: 'account',
      },
      {
        list: () => Promise.resolve([{ id: 'lvbt-labs-map-staging' }]),
        get: (endpoint) =>
          Promise.resolve(
            endpoint.endsWith('/deployments')
              ? {
                  deployments: [
                    {
                      created_on: '2026-09-05T00:00:00Z',
                      versions: [{ version_id: active, percentage: 100 }],
                    },
                  ],
                }
              : { resources: { bindings: [] } },
          ),
      },
      async (args, output) => {
        argsSeen.push(args);
        active = deployed;
        await writeFile(
          output,
          JSON.stringify({
            type: 'deploy',
            version: 1,
            worker_name: 'lvbt-labs-map-staging',
            version_id: deployed,
            targets: ['https://lvbt-labs-map-staging.example.workers.dev/'],
          }),
        );
      },
    );

    expect(receipt).toEqual({
      version: deployed,
      url: 'https://lvbt-labs-map-staging.example.workers.dev/',
      previousVersion: previous,
    });
    expect(argsSeen[0]?.[0]).toBe('deploy');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
