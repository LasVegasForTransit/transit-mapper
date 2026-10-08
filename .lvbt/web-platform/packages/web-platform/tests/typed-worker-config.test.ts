import { expect, test } from 'vitest';
import { typedWorkerConfiguration, resolveTypedConfiguration } from '../src/typed-worker-config.js';
const worker = {
  name: 'participant',
  entrypoint: '../site/worker/index.ts',
  compatibilityDate: '2026-08-31',
  observability: { enabled: true, redactQueryString: true },
  assets: {
    htmlHandling: 'drop-trailing-slash',
    notFoundHandling: '404-page',
    runWorkerFirst: true,
  },
  triggers: [
    { type: 'fetch', pattern: 'participant.example.org/*', zone: 'example.org' },
    { type: 'scheduled', schedule: '0 13 * * *' },
  ],
  env: {
    DB: { type: 'd1', name: 'participants', id: 'production-id' },
    PHOTOS: { type: 'r2', name: 'production-photos' },
    ASSETS: { type: 'assets' },
    TOKEN: { type: 'secret' },
    ENABLED: { type: 'text', value: 'false' },
  },
};
const config = {
  repository: 'Example/participant',
  appDirectory: 'apps/deploy',
  productionWorker: 'participant',
  previewWorker: 'participant-preview',
  productionUrl: 'https://participant.example.org',
  previewUrl: 'https://preview.example.org',
  artifactPrefix: 'participant-release',
  stagingWorkflow: { name: 'Deploy staging', path: '.github/workflows/deploy.yml', branch: 'main' },
  promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote participant', branch: 'main' },
  previewBindings: {
    ...worker.env,
    DB: { type: 'd1', name: 'preview-participants', id: 'preview-id' },
    PHOTOS: { type: 'r2', name: 'preview-photos' },
  },
};
test('typed canonical Worker settings generate one complete build configuration and isolated preview without cron', () => {
  const generated = typedWorkerConfiguration({ worker }, config);
  expect(generated).toMatchObject({
    name: 'participant',
    main: '../site/worker/index.ts',
    compatibility_date: '2026-08-31',
    observability: { enabled: true, redact_query_string: true },
    routes: [{ pattern: 'participant.example.org/*', zone_name: 'example.org' }],
    triggers: { crons: ['0 13 * * *'] },
    d1_databases: [{ binding: 'DB', database_name: 'participants', database_id: 'production-id' }],
    r2_buckets: [{ binding: 'PHOTOS', bucket_name: 'production-photos' }],
    vars: { ENABLED: 'false', LVBT_DEPLOYMENT_ENV: 'production' },
    env: {
      preview: {
        name: 'participant-preview',
        triggers: { crons: [] },
        d1_databases: [
          { binding: 'DB', database_name: 'preview-participants', database_id: 'preview-id' },
        ],
        r2_buckets: [{ binding: 'PHOTOS', bucket_name: 'preview-photos' }],
      },
    },
  });
  expect(JSON.stringify(generated)).not.toContain('TOKEN');
});
test('typed generation rejects missing or reused preview resources and undeclared settings', () => {
  for (const previewBindings of [
    undefined,
    worker.env,
    { ...config.previewBindings, PHOTOS: worker.env.PHOTOS },
    { ...config.previewBindings, DB: worker.env.DB },
  ]) {
    expect(() => typedWorkerConfiguration({ worker }, { ...config, previewBindings })).toThrow();
  }
  expect(() =>
    typedWorkerConfiguration({ worker: { ...worker, experimentalSetting: true } }, config),
  ).toThrow();
  expect(() =>
    typedWorkerConfiguration({ worker: { ...worker, name: 'another-worker' } }, config),
  ).toThrow('configured');
});
test('canonical upload metadata retains text and key credentials and preview mode retains its routing policy', () => {
  const unsafe = { metadata: { keep_bindings: ['secret_text', 'secret_key'] } };
  const production = {
    worker: { ...worker, unsafe, assets: { ...worker.assets, runWorkerFirst: ['/api/*'] } },
  };
  const preview = {
    worker: {
      ...worker,
      name: 'participant-preview',
      unsafe,
      assets: { ...worker.assets, runWorkerFirst: true },
    },
  };
  expect(typedWorkerConfiguration(production, config, preview)).toMatchObject({
    unsafe,
    assets: { run_worker_first: ['/api/*', '/lvbt-release.json'] },
    env: { preview: { unsafe, assets: { run_worker_first: true } } },
  });
});
test('mode factories retain the deployed SQLite Durable Object class and isolate its preview namespace', async () => {
  const canonical = await resolveTypedConfiguration(({ mode }: { mode: string }) => ({
    worker: {
      ...worker,
      name: mode === 'preview' ? 'participant-preview' : 'participant',
      domains: ['participant.example.org'],
      assets: { ...worker.assets, runWorkerFirst: ['/api/*'] },
      exports: { PlaceSearchGate: { type: 'durable-object', storage: 'sqlite' } },
      env: {
        ...worker.env,
        GATE: { type: 'durable-object', worker: 'participant', exportName: 'PlaceSearchGate' },
      },
    },
  }));
  const scoped = {
    ...config,
    previewBindings: {
      ...config.previewBindings,
      GATE: {
        type: 'durable-object',
        worker: 'participant-preview',
        exportName: 'PlaceSearchGate',
      },
    },
  };
  expect(typedWorkerConfiguration(canonical, scoped)).toMatchObject({
    exports: { PlaceSearchGate: { type: 'durable-object', storage: 'sqlite' } },
    assets: { run_worker_first: ['/api/*', '/lvbt-release.json'] },
    durable_objects: {
      bindings: [{ name: 'GATE', class_name: 'PlaceSearchGate', script_name: 'participant' }],
    },
    env: {
      preview: {
        durable_objects: {
          bindings: [
            { name: 'GATE', class_name: 'PlaceSearchGate', script_name: 'participant-preview' },
          ],
        },
      },
    },
  });
  expect(() =>
    typedWorkerConfiguration(canonical, {
      ...scoped,
      previewBindings: {
        ...scoped.previewBindings,
        GATE: { type: 'durable-object', worker: 'foreign-worker', exportName: 'PlaceSearchGate' },
      },
    }),
  ).toThrow('namespace');
});

test('public account context is retained and draft profiles cannot invent published routes', () => {
  const accountId = '2'.repeat(32);
  const draft = { ...config, publicPath: '/draft/', previewOnly: true };
  const unpublished = { ...worker, domains: [], triggers: [] };
  expect(typedWorkerConfiguration({ accountId, worker: unpublished }, draft)).toMatchObject({
    account_id: accountId,
  });
  expect(() =>
    typedWorkerConfiguration({ worker: unpublished }, { ...draft, previewOnly: false }),
  ).toThrow('public path');
  expect(() =>
    typedWorkerConfiguration(
      { worker: { ...worker, domains: ['participant.example.org'] } },
      { ...config, publicPath: '/nested/' },
    ),
  ).toThrow('public path');
});
