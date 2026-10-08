import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { runPrPreview } from '../src/release-pr-preview-command.js';
const config = {
  repository: 'Example/app',
  appDirectory: 'app',
  productionWorker: 'app',
  previewWorker: 'app-preview',
  productionUrl: 'https://example.org',
  previewUrl: 'https://preview.example.org',
  workersDevSubdomain: 'reviewed-account',
  publicationMode: 'named-staging' as const,
  artifactPrefix: 'app-release',
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
  '--action',
  'delete',
];
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'pr-delete-'));
  const event = path.join(root, 'event.json');
  await writeFile(
    event,
    JSON.stringify({
      action: 'closed',
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
    CLOUDFLARE_ACCOUNT_ID: '1'.repeat(32),
    CLOUDFLARE_API_TOKEN: 'test-token',
  }))
    vi.stubEnv(name, value);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});
test('closed PR deletion first verifies account identity, deletes only the derived Worker, and accepts absence', async () => {
  const request = vi.fn((url: string, options: RequestInit) => {
    expect(options.redirect).toBe('error');
    return Promise.resolve(
      url.endsWith('/subdomain')
        ? Response.json({ success: true, result: { subdomain: 'reviewed-account' } })
        : new Response('', { status: 404 }),
    );
  });
  vi.stubGlobal('fetch', request);
  await runPrPreview(config, args);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]?.[0]).toBe(
    `https://api.cloudflare.com/client/v4/accounts/${'1'.repeat(32)}/workers/scripts/app-pr-42?force=true`,
  );
  expect(request.mock.calls[1]?.[1].method).toBe('DELETE');
});
test('wrong account, open events and unexpected provider failures never silently remove other namespaces', async () => {
  const request = vi.fn(() =>
    Promise.resolve(Response.json({ success: true, result: { subdomain: 'foreign-account' } })),
  );
  vi.stubGlobal('fetch', request);
  await expect(runPrPreview(config, args)).rejects.toThrow('reviewed Workers account');
  expect(request).toHaveBeenCalledTimes(1);
  await writeFile(
    path.join(root, 'event.json'),
    JSON.stringify({
      action: 'synchronize',
      number: 42,
      pull_request: {
        head: { repo: { full_name: config.repository } },
        base: { ref: 'main', repo: { full_name: config.repository } },
      },
    }),
  );
  await expect(runPrPreview(config, args)).rejects.toThrow('closed');
  expect(request).toHaveBeenCalledTimes(1);
});

test('provider errors other than confirmed absence fail cleanup', async () => {
  const request = vi.fn((url: string) =>
    Promise.resolve(
      url.endsWith('/subdomain')
        ? Response.json({ success: true, result: { subdomain: 'reviewed-account' } })
        : Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 403 }),
    ),
  );
  vi.stubGlobal('fetch', request);
  await expect(runPrPreview(config, args)).rejects.toThrow('reconcile');
  expect(request).toHaveBeenCalledTimes(2);
});
