import { expect, test } from 'vitest';
import {
  previewConfiguration,
  previewUploadReceipt,
  stagingPreviewConfiguration,
} from '../src/pr-preview-config.ts';

test('isolates static preview configuration from production routes and variables', () => {
  const config = previewConfiguration(
    {
      name: 'lvbt-labs-home',
      compatibility_date: '2026-08-31',
      assets: { directory: './dist', not_found_handling: '404-page' },
      routes: [{ pattern: 'labs.example.org', custom_domain: true }],
      vars: { PUBLIC_LVBT_CWA_TOKEN: 'production-token' },
    },
    'lvbt-labs-pr-3-home',
    '/tmp/preview/assets',
    'temporary',
  );
  expect(config.routes).toEqual([]);
  expect(config.assets.directory).toBe('/tmp/preview/assets');
  expect(config.workers_dev).toBe(true);
  expect(JSON.stringify(config)).not.toContain('production-token');
});

test('version upload configuration does not enable the production workers.dev address', () => {
  const config = previewConfiguration(
    { compatibility_date: '2026-08-31', assets: { directory: 'dist' } },
    'lvbt-labs-home',
    '/tmp/assets',
    'version',
  );
  expect(config.workers_dev).toBe(false);
  expect(config.preview_urls).toBe(true);
});

test('rejects Worker code and bindings without an explicit isolated staging configuration', () => {
  expect(() =>
    previewConfiguration(
      { main: './worker.ts', assets: { directory: 'dist' } },
      'lvbt-labs-map',
      '/tmp/assets',
      'version',
    ),
  ).toThrow();
});

test('preserves explicitly isolated staging code and bindings without production routes', () => {
  const config = stagingPreviewConfiguration(
    {
      name: 'lvbt-labs-map-staging',
      main: './src/worker.ts',
      compatibility_date: '2026-08-31',
      assets: { directory: './dist' },
      durable_objects: { bindings: [{ name: 'MAP', class_name: 'MapState' }] },
      routes: [],
      workers_dev: true,
      preview_urls: false,
      vars: { DEPLOYMENT_ENVIRONMENT: 'staging' },
    },
    'lvbt-labs-map-staging',
    '/tmp/preview/assets',
  );

  expect(config).toMatchObject({
    name: 'lvbt-labs-map-staging',
    main: './src/worker.ts',
    assets: { directory: '/tmp/preview/assets' },
    durable_objects: { bindings: [{ name: 'MAP', class_name: 'MapState' }] },
    routes: [],
    workers_dev: true,
    preview_urls: false,
    vars: { DEPLOYMENT_ENVIRONMENT: 'staging' },
  });
});

test.each([
  { name: 'lvbt-labs-map', routes: [], workers_dev: true, preview_urls: false },
  {
    name: 'lvbt-labs-map-staging',
    routes: [{ pattern: 'labs.example.org/map/*', zone_name: 'example.org' }],
    workers_dev: true,
    preview_urls: false,
  },
  {
    name: 'lvbt-labs-map-staging',
    routes: [],
    workers_dev: true,
    preview_urls: false,
    vars: { PUBLIC_LVBT_CWA_TOKEN: 'production-token' },
  },
])('rejects a staging configuration that is not isolated', (unsafe) => {
  expect(() =>
    stagingPreviewConfiguration(
      {
        ...unsafe,
        main: './src/worker.ts',
        compatibility_date: '2026-08-31',
        assets: { directory: './dist' },
      },
      'lvbt-labs-map-staging',
      '/tmp/preview/assets',
    ),
  ).toThrow();
});

test('reads structured upload output and refuses mismatched or missing preview URLs', () => {
  const entry = {
    type: 'version-upload',
    version: 1,
    worker_name: 'lvbt-labs-home',
    version_id: '12345678-1234-1234-1234-123456789abc',
    preview_url: 'https://12345678-lvbt-labs-home.example.workers.dev',
  };
  expect(previewUploadReceipt(JSON.stringify(entry), 'lvbt-labs-home')).toEqual({
    version: entry.version_id,
    url: entry.preview_url,
  });
  expect(() =>
    previewUploadReceipt(JSON.stringify({ ...entry, worker_name: 'other' }), 'lvbt-labs-home'),
  ).toThrow();
  expect(() =>
    previewUploadReceipt(JSON.stringify({ ...entry, preview_url: null }), 'lvbt-labs-home'),
  ).toThrow();
  expect(() =>
    previewUploadReceipt(
      JSON.stringify({ ...entry, preview_url: 'https://evil.example/' }),
      'lvbt-labs-home',
    ),
  ).toThrow();
});
