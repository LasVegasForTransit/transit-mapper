import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
const root = resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

test('the application deploy alias cannot bypass retained publication from its package directory', () => {
  const worker = JSON.parse(read('apps/worker/package.json')) as {
    scripts: Record<string, string>;
  };
  expect(worker.scripts.deploy).toBe('pnpm --dir ../.. run deploy');
  expect(read('package.json')).not.toContain('cf deploy');
});

test('main builds, signs, and stages retained TransitMapper bytes without automatic production activation', () => {
  const staging = read('.github/workflows/deploy-production.yml');
  expect(staging).toContain('release-build.yml@');
  expect(staging).toContain('release-attest.yml@');
  expect(staging).toContain('release-publish.yml@');
  expect(staging).toContain('target: preview');
  expect(staging).toContain('publication-mode: named-staging');
  expect(staging).not.toContain('target: production');
  expect(staging).not.toContain('cf deploy');
  expect(staging).not.toContain('migrations apply');
  expect(staging).toContain('googleapis/release-please-action@');
  expect(staging).toContain('uses: ./.github/workflows/performance.yml');
});

test('only explicit promotion selects the retained source and named production activation', () => {
  const promotion = read('.github/workflows/promote.yml');
  expect(promotion).toContain('workflow_dispatch:');
  expect(promotion).not.toContain('push:');
  expect(promotion).toContain('release-source.yml@');
  expect(promotion).toContain('target: production');
  expect(promotion).toContain('publication-mode: named-staging');
  expect(promotion).toContain('attestation-prefix: attestation-transitmapper-release');
  expect(promotion).toContain('browser-script: release:acceptance');
  expect(promotion).toContain('preview-environment: preview');
  expect(promotion).toContain('production-environment: production');
});

test('the declared release preserves production DO identity and frozen SQL while requiring reviewed isolated preview resources', () => {
  const tooling = JSON.parse(read('.lvbt/tooling.json')) as {
    release: Record<string, unknown>;
  };
  expect(tooling.release).toMatchObject({
    artifactSource: 'typed-worker',
    typedConfig: 'cloudflare.config.ts',
    assetsDirectory: '../web/dist',
    publicationMode: 'named-staging',
    productionWorker: 'transitmapper',
    previewWorker: 'transitmapper-preview',
    workersDevSubdomain: 'las-vegas-for-better-transit',
    previewBindingsEnv: 'LVBT_PREVIEW_BINDINGS',
    previewReadOnlyBindings: ['GTFS_ARCHIVES'],
    migrations: [{ binding: 'DB', directory: 'src/migrations' }],
  });
  expect(read('apps/worker/cloudflare.config.ts')).toContain("limiter('1001', 20, 60, preview)");
});
