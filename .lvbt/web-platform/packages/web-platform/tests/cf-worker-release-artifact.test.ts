import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { ReleaseConfiguration } from '../src/release-config';
import { verifyRelease } from '../src/saved-release-artifact';
import { packageWorkerCfRelease } from '../src/cf-worker-release-artifact';
interface WranglerTarget {
  analytics_engine_datasets: unknown[];
  ratelimits: { namespace_id: string }[];
  vars: Record<string, string>;
}
interface WranglerConfig extends WranglerTarget {
  env: { preview: WranglerTarget };
}
interface WorkerRuntime {
  default: { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };
  named: string;
}
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const identity = { commit: 'a'.repeat(40), releaseId: '100' };
const configuration: ReleaseConfiguration & { previewBindings: Record<string, unknown> } = {
  repository: 'LasVegasForTransit/analytics',
  appDirectory: 'apps/collector',
  productionWorker: 'lvbt-analytics-events',
  previewWorker: 'lvbt-analytics-events-preview',
  productionUrl: 'https://events.lasvegasfortransit.org',
  previewUrl: 'https://events-preview.example.test',
  artifactPrefix: 'analytics-release',
  artifactSource: 'cf-output',
  stagingWorkflow: {
    name: 'Deploy collector staging',
    path: '.github/workflows/deploy-collector-staging.yml',
    branch: 'main',
  },
  promotionWorkflow: {
    file: 'promote-collector.yml',
    titlePrefix: 'Promote collector release',
    branch: 'main',
  },
  previewBindings: {
    EVENTS: { type: 'analytics-engine-dataset', name: 'lvbt_events_preview' },
    EVENT_LIMITER: { type: 'rate-limit', namespace: '1002', simple: { limit: 30, period: 60 } },
    LVBT_EVENTS_SECRET: { type: 'secret' },
  },
};
const descriptor = {
  name: 'lvbt-analytics-events',
  compatibilityDate: '2026-08-22',
  compatibilityFlags: ['nodejs_compat'],
  domains: ['events.lasvegasfortransit.org'],
  observability: { enabled: true, headSamplingRate: 1 },
  workersDev: false,
  env: {
    EVENTS: { type: 'analytics-engine-dataset', name: 'lvbt_events' },
    EVENT_LIMITER: { type: 'rate-limit', namespace: '1001', simple: { limit: 30, period: 60 } },
    LVBT_EVENTS_SECRET: { type: 'secret' },
  },
  manifest: {
    type: 'complete',
    mainModule: 'index.js',
    modules: { 'index.js': { type: 'esm' }, 'events.js': { type: 'esm' } },
  },
};
const original = `import {health} from './events.js';\nexport const named = 'preserved';\nexport default {async fetch(request,env){if(new URL(request.url).pathname==='/health')return new Response(health);await env.EVENT_LIMITER.limit({key:'test'});env.EVENTS.writeDataPoint({blobs:['test']});return new Response(null,{status:204});}};\n`;
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lvbt-worker-release-'));
  roots.push(root);
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  const source = path.join(root, 'source');
  const output = path.join(source, '.cloudflare/output/v0/workers/default');
  await mkdir(path.join(output, 'bundle'), { recursive: true });
  await writeFile(path.join(output, 'worker.config.json'), JSON.stringify(descriptor));
  await writeFile(path.join(output, 'bundle/index.js'), original);
  await writeFile(path.join(output, 'bundle/events.js'), "export const health='ok';\n");
  return { source, destination: path.join(root, 'saved'), output };
}
it('seals original worker code and explicitly isolated bindings into a saved v1 worker release', async () => {
  const setup = await fixture();
  const release = await packageWorkerCfRelease(
    setup.source,
    setup.destination,
    identity,
    configuration,
  );
  expect(release.artifactKind).toBe('worker');
  expect(
    await readFile(path.join(setup.destination, '.wrangler/worker/bundle/index.js'), 'utf8'),
  ).toBe(original);
  expect(await verifyRelease(setup.destination)).toEqual(release);
  const config = JSON.parse(
    await readFile(path.join(setup.destination, 'wrangler.jsonc'), 'utf8'),
  ) as WranglerConfig;
  expect(config.analytics_engine_datasets).toEqual([{ binding: 'EVENTS', dataset: 'lvbt_events' }]);
  expect(config.env.preview.analytics_engine_datasets).toEqual([
    { binding: 'EVENTS', dataset: 'lvbt_events_preview' },
  ]);
  expect(config.ratelimits[0]?.namespace_id).toBe('1001');
  expect(config.env.preview.ratelimits[0]?.namespace_id).toBe('1002');
  expect(config.vars.LVBT_EVENTS_SECRET).toBeUndefined();
  expect(config.env.preview.vars.LVBT_EVENTS_SECRET).toBeUndefined();
});
it('saved marker describes the packaged identity while the original runtime keeps handling requests', async () => {
  const setup = await fixture();
  await packageWorkerCfRelease(setup.source, setup.destination, identity, configuration);
  const runtime = (await import(
    pathToFileURL(path.join(setup.destination, '.wrangler/worker/index.js')).href
  )) as WorkerRuntime;
  const writes: unknown[] = [];
  const calls: string[] = [];
  const env = {
    EVENTS: { writeDataPoint: (data: unknown) => writes.push(data) },
    EVENT_LIMITER: {
      limit: () => {
        calls.push('preview');
        return { success: true };
      },
    },
  };
  const marker = await runtime.default.fetch(
    new Request('https://preview.example.test/lvbt-release.json'),
    env,
    {},
  );
  expect(await marker.json()).toEqual(identity);
  expect(writes).toHaveLength(0);
  expect(calls).toHaveLength(0);
  expect(
    await (
      await runtime.default.fetch(new Request('https://preview.example.test/health'), env, {})
    ).text(),
  ).toBe('ok');
  expect(
    (await runtime.default.fetch(new Request('https://preview.example.test/e'), env, {})).status,
  ).toBe(204);
  expect(writes).toEqual([{ blobs: ['test'] }]);
  expect(calls).toEqual(['preview']);
  expect(runtime.named).toBe('preserved');
});
it('tampered compiled code or saved marker cannot verify', async () => {
  const setup = await fixture();
  await packageWorkerCfRelease(setup.source, setup.destination, identity, configuration);
  await writeFile(path.join(setup.destination, '.wrangler/worker/bundle/index.js'), 'changed code');
  await expect(verifyRelease(setup.destination)).rejects.toThrow(/reviewed|match|artifact/i);
});
it('missing or production-equivalent preview resources and unsupported bindings fail closed', async () => {
  for (const config of [
    { ...configuration, previewBindings: {} },
    {
      ...configuration,
      previewBindings: { ...configuration.previewBindings, EVENTS: descriptor.env.EVENTS },
    },
    {
      ...configuration,
      previewBindings: {
        ...configuration.previewBindings,
        EVENT_LIMITER: descriptor.env.EVENT_LIMITER,
      },
    },
  ]) {
    const setup = await fixture();
    await expect(
      packageWorkerCfRelease(setup.source, setup.destination, identity, config),
    ).rejects.toThrow(/preview|isolat|binding/i);
  }
  const setup = await fixture();
  await writeFile(
    path.join(setup.output, 'worker.config.json'),
    JSON.stringify({
      ...descriptor,
      env: { ...descriptor.env, UNSUPPORTED: { type: 'durable-object', className: 'Session' } },
    }),
  );
  await expect(
    packageWorkerCfRelease(setup.source, setup.destination, identity, configuration),
  ).rejects.toThrow(/unsupported|binding|type/i);
});

it('changed saved identity marker and unlisted or escaping modules cannot be accepted', async () => {
  const marker = await fixture();
  await packageWorkerCfRelease(marker.source, marker.destination, identity, configuration);
  await writeFile(
    path.join(marker.destination, 'lvbt-release.json'),
    JSON.stringify({ ...identity, commit: 'b'.repeat(40) }),
  );
  await expect(verifyRelease(marker.destination)).rejects.toThrow(/match|reviewed|artifact/i);
  const missing = await fixture();
  await writeFile(
    path.join(missing.output, 'worker.config.json'),
    JSON.stringify({
      ...descriptor,
      manifest: { ...descriptor.manifest, mainModule: 'unlisted.js' },
    }),
  );
  await expect(
    packageWorkerCfRelease(missing.source, missing.destination, identity, configuration),
  ).rejects.toThrow(/main module/);
  const escaped = await fixture();
  await writeFile(
    path.join(escaped.output, 'worker.config.json'),
    JSON.stringify({
      ...descriptor,
      manifest: {
        ...descriptor.manifest,
        mainModule: '../outside.js',
        modules: { '../outside.js': { type: 'esm' } },
      },
    }),
  );
  await expect(
    packageWorkerCfRelease(escaped.source, escaped.destination, identity, configuration),
  ).rejects.toThrow(/bundle|module|inside/);
});
