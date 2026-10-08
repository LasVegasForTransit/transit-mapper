import { expect, test } from 'vitest';
import { assertWorkerReleaseConfiguration } from '../src/worker-release-configuration.js';
const identity = { productionWorker: 'site', previewWorker: 'site-preview' };
const config = {
  name: 'site',
  d1_databases: [{ binding: 'DB', database_id: 'production' }],
  env: { preview: { d1_databases: [{ binding: 'DB', database_id: 'staging' }] } },
};
test('reviewed releases require separate staging data before any Worker upload', () => {
  expect(() => assertWorkerReleaseConfiguration(config, identity)).not.toThrow();
  expect(() =>
    assertWorkerReleaseConfiguration(
      {
        ...config,
        env: { preview: { d1_databases: [{ binding: 'DB', database_id: 'production' }] } },
      },
      identity,
    ),
  ).toThrow('D1');
  expect(() =>
    assertWorkerReleaseConfiguration(
      { ...config, env: { preview: { d1_databases: [] } } },
      identity,
    ),
  ).toThrow('D1');
});
test('reviewed releases cannot switch either configured Worker namespace', () => {
  expect(() => assertWorkerReleaseConfiguration({ ...config, name: 'other' }, identity)).toThrow(
    'Worker',
  );
  expect(() =>
    assertWorkerReleaseConfiguration(
      { ...config, env: { preview: { ...config.env.preview, name: 'site' } } },
      identity,
    ),
  ).toThrow('Worker');
});
test('preview uploads cannot share writable photo buckets or enable production schedules', () => {
  expect(() =>
    assertWorkerReleaseConfiguration(
      {
        ...config,
        r2_buckets: [{ binding: 'PHOTOS', bucket_name: 'production-photos' }],
        env: {
          preview: {
            ...config.env.preview,
            r2_buckets: [{ binding: 'PHOTOS', bucket_name: 'production-photos' }],
          },
        },
      },
      identity,
    ),
  ).toThrow('R2');
  expect(() =>
    assertWorkerReleaseConfiguration(
      {
        ...config,
        env: { preview: { ...config.env.preview, triggers: { crons: ['0 13 * * *'] } } },
      },
      identity,
    ),
  ).toThrow('schedule');
});

test('saved Worker declarations reject shared Durable Object namespaces, counters, and uninitialized database IDs', () => {
  const production = {
    name: 'app',
    durable_objects: { bindings: [{ name: 'GATE', class_name: 'Gate', script_name: 'app' }] },
    ratelimits: [{ name: 'LIMIT', namespace_id: '1001', simple: { limit: 10, period: 60 } }],
    d1_databases: [{ binding: 'DB', database_id: 'production-id' }],
    env: {
      preview: {
        name: 'app-preview',
        durable_objects: {
          bindings: [{ name: 'GATE', class_name: 'Gate', script_name: 'app-preview' }],
        },
        ratelimits: [{ name: 'LIMIT', namespace_id: '2001', simple: { limit: 10, period: 60 } }],
        d1_databases: [{ binding: 'DB', database_id: 'preview-id' }],
      },
    },
  };
  const expected = { productionWorker: 'app', previewWorker: 'app-preview' };
  expect(() => assertWorkerReleaseConfiguration(production, expected)).not.toThrow();
  for (const override of [
    { durable_objects: production.durable_objects },
    { ratelimits: production.ratelimits },
    { d1_databases: [{ binding: 'DB', database_id: '00000000-0000-0000-0000-000000000000' }] },
  ])
    expect(() =>
      assertWorkerReleaseConfiguration(
        { ...production, env: { preview: { ...production.env.preview, ...override } } },
        expected,
      ),
    ).toThrow();
});
