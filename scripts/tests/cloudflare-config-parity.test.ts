import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

// The root check uses Node types, while cf's package declarations require the
// Worker runtime types. Load the config at runtime and type only the fields this
// parity check inspects; apps/worker typechecks the config with Worker types.
interface CfWorker {
  name: string;
  env: Record<string, unknown>;
  triggers?: unknown[];
  exports: Record<string, unknown>;
  [key: string]: unknown;
}

interface CfConfig {
  worker: CfWorker;
}

const { default: cloudflareConfig } = (await import(
  resolve(import.meta.dirname, '../../apps/worker/cloudflare.config.ts')
)) as { default: (context: { mode?: string; isPreview: boolean }) => CfConfig };

interface WranglerRateLimit {
  name: string;
  namespace_id: string;
  simple: { limit: number; period: number };
}

interface WranglerScope {
  name?: string;
  main?: string;
  compatibility_date?: string;
  account_id?: string;
  vars: Record<string, string>;
  routes?: { pattern: string; custom_domain?: boolean; zone_name?: string }[];
  triggers?: { crons: string[] };
  d1_databases: { binding: string; database_name: string; database_id: string }[];
  r2_buckets: { binding: string; bucket_name: string }[];
  durable_objects: { bindings: { name: string; class_name: string }[] };
  ratelimits: WranglerRateLimit[];
}

interface WranglerConfig extends WranglerScope {
  observability: { enabled: boolean; head_sampling_rate: number };
  assets: {
    directory: string;
    binding: string;
    not_found_handling: string;
    run_worker_first: string[];
  };
  env: { preview: WranglerScope & { workers_dev: boolean; preview_urls: boolean } };
}

const wrangler = parse(
  readFileSync(resolve(import.meta.dirname, '../../apps/worker/wrangler.toml'), 'utf8'),
) as unknown as WranglerConfig;
const preview = wrangler.env.preview;

function worker(mode?: string) {
  return cloudflareConfig({ mode, isPreview: false }).worker;
}

function expectBindingsMatch(scope: WranglerScope, cfWorker: ReturnType<typeof worker>) {
  const env = cfWorker.env;
  for (const [name, value] of Object.entries(scope.vars)) {
    expect(env[name]).toMatchObject({ type: 'text', value });
  }
  for (const database of scope.d1_databases) {
    expect(env[database.binding]).toMatchObject({
      type: 'd1',
      name: database.database_name,
      id: database.database_id,
    });
  }
  for (const bucket of scope.r2_buckets) {
    expect(env[bucket.binding]).toMatchObject({ type: 'r2', name: bucket.bucket_name });
  }
  for (const object of scope.durable_objects.bindings) {
    expect(env[object.name]).toMatchObject({
      type: 'durable-object',
      worker: cfWorker.name,
      exportName: object.class_name,
    });
  }
  for (const rate of scope.ratelimits) {
    expect(env[rate.name]).toMatchObject({
      type: 'rate-limit',
      namespace: rate.namespace_id,
      simple: rate.simple,
    });
  }
  expect(env[wrangler.assets.binding]).toMatchObject({ type: 'assets' });
  expect(Object.keys(env).sort()).toEqual(
    [
      ...Object.keys(scope.vars),
      ...scope.d1_databases.map((value) => value.binding),
      ...scope.r2_buckets.map((value) => value.binding),
      ...scope.durable_objects.bindings.map((value) => value.name),
      ...scope.ratelimits.map((value) => value.name),
      wrangler.assets.binding,
    ].sort(),
  );
}

describe('cf and the Wrangler fallback', () => {
  it('keep the production host, routes, cron, assets, and bindings aligned', () => {
    const config = cloudflareConfig({ mode: undefined, isPreview: false });
    const cfWorker = config.worker;
    expect(config).not.toHaveProperty('accountId');
    expect(cfWorker).toMatchObject({
      name: wrangler.name,
      entrypoint: wrangler.main,
      compatibilityDate: wrangler.compatibility_date,
      observability: {
        enabled: wrangler.observability.enabled,
        headSamplingRate: wrangler.observability.head_sampling_rate,
      },
      assets: {
        notFoundHandling: wrangler.assets.not_found_handling,
        runWorkerFirst: wrangler.assets.run_worker_first,
      },
      domains: wrangler.routes
        ?.filter((route) => route.custom_domain)
        .map((route) => route.pattern),
    });
    expect(cfWorker.triggers).toEqual([
      ...(wrangler.routes ?? [])
        .filter((route) => !route.custom_domain)
        .map((route) => ({ type: 'fetch', pattern: route.pattern, zone: route.zone_name })),
      ...(wrangler.triggers?.crons ?? []).map((schedule) => ({ type: 'scheduled', schedule })),
    ]);
    expectBindingsMatch(wrangler, cfWorker);
    expect(cfWorker.exports.PlaceSearchGate).toMatchObject({
      type: 'durable-object',
      storage: 'sqlite',
    });
  });

  it('keeps previews off production routes and cron while retaining every binding', () => {
    const cfWorker = worker('preview');
    expect(cfWorker).toMatchObject({
      name: 'transitmapper-preview',
      workersDev: preview.workers_dev,
      previewUrls: preview.preview_urls,
    });
    expect(cfWorker).not.toHaveProperty('domains');
    expect(cfWorker).not.toHaveProperty('triggers');
    expectBindingsMatch(preview, cfWorker);
  });

  it('uses the CI preview target without changing production', () => {
    const previous = {
      name: process.env.TRANSITMAPPER_PREVIEW_NAME,
      url: process.env.TRANSITMAPPER_PREVIEW_URL,
      database: process.env.TRANSITMAPPER_PREVIEW_DB_ID,
    };
    try {
      process.env.TRANSITMAPPER_PREVIEW_NAME = 'transitmapper-pr-999';
      process.env.TRANSITMAPPER_PREVIEW_URL = 'https://transitmapper-pr-999.example.workers.dev';
      process.env.TRANSITMAPPER_PREVIEW_DB_ID = '11111111-1111-4111-8111-111111111111';
      expect(worker('preview')).toMatchObject({
        name: 'transitmapper-pr-999',
        env: {
          SITE_URL: { value: process.env.TRANSITMAPPER_PREVIEW_URL },
          DB: { id: process.env.TRANSITMAPPER_PREVIEW_DB_ID },
          PLACE_SEARCH_GATE: { worker: 'transitmapper-pr-999' },
        },
      });
      expect(worker()).toMatchObject({ name: 'transitmapper' });
    } finally {
      if (previous.name === undefined) delete process.env.TRANSITMAPPER_PREVIEW_NAME;
      else process.env.TRANSITMAPPER_PREVIEW_NAME = previous.name;
      if (previous.url === undefined) delete process.env.TRANSITMAPPER_PREVIEW_URL;
      else process.env.TRANSITMAPPER_PREVIEW_URL = previous.url;
      if (previous.database === undefined) delete process.env.TRANSITMAPPER_PREVIEW_DB_ID;
      else process.env.TRANSITMAPPER_PREVIEW_DB_ID = previous.database;
    }
  });
});
