import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ReleaseConfiguration } from './release-config.js';
import { configuredReleaseIdentity, workerReleaseEntry } from './worker-release-entry.js';
import { sealSavedRelease, type WebsiteRelease } from './saved-release-artifact.js';

const dataset = z.strictObject({
  type: z.literal('analytics-engine-dataset'),
  name: z.string().regex(/^[A-Za-z0-9_]+$/),
});
const rateLimit = z.strictObject({
  type: z.literal('rate-limit'),
  namespace: z.string().regex(/^\d+$/),
  simple: z.strictObject({
    limit: z.number().int().positive(),
    period: z.union([z.literal(10), z.literal(60)]),
  }),
});
const secret = z.strictObject({ type: z.literal('secret') });
const binding = z.discriminatedUnion('type', [dataset, rateLimit, secret]);
const bindings = z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), binding);
type Bindings = z.infer<typeof bindings>;
const modulePath = z
  .string()
  .regex(/^[A-Za-z0-9_./-]+\.m?js$/)
  .refine(
    (value) => !path.isAbsolute(value) && !value.split('/').includes('..'),
    'Compiled modules must stay inside the bundle.',
  );
const descriptor = z.strictObject({
  name: z.string(),
  compatibilityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  compatibilityFlags: z.array(z.string()).optional(),
  domains: z.array(z.string()),
  workersDev: z.boolean().optional(),
  previewUrls: z.boolean().optional(),
  observability: z
    .strictObject({ enabled: z.boolean(), headSamplingRate: z.number().min(0).max(1).optional() })
    .optional(),
  env: bindings,
  manifest: z.strictObject({
    type: z.literal('complete'),
    mainModule: modulePath,
    modules: z.record(modulePath, z.strictObject({ type: z.literal('esm') })),
  }),
});

export type WorkerReleaseConfiguration = ReleaseConfiguration & {
  previewBindings?: Record<string, unknown> | undefined;
};
function assertBindingIsolation(
  name: string,
  value: Bindings[string],
  candidate: Bindings[string] | undefined,
): void {
  if (candidate?.type !== value.type)
    throw new Error(`Preview binding ${name} must retain its declared type.`);
  if (
    value.type === 'analytics-engine-dataset' &&
    candidate.type === 'analytics-engine-dataset' &&
    candidate.name === value.name
  )
    throw new Error(`Preview binding ${name} must use an isolated Analytics Engine dataset.`);
  if (value.type === 'rate-limit' && candidate.type === 'rate-limit') {
    if (BigInt(candidate.namespace) === BigInt(value.namespace))
      throw new Error(`Preview binding ${name} must use an isolated rate-limit namespace.`);
    if (
      candidate.simple.limit !== value.simple.limit ||
      candidate.simple.period !== value.simple.period
    )
      throw new Error(`Preview binding ${name} must retain production rate-limit behavior.`);
  }
}
function previewBindings(production: Bindings, config: WorkerReleaseConfiguration): Bindings {
  if (!config.previewBindings)
    throw new Error('Declare every isolated preview binding before packaging a Worker release.');
  const preview = bindings.parse(config.previewBindings);
  if (
    config.previewWorker === config.productionWorker ||
    config.previewUrl === config.productionUrl
  )
    throw new Error('Preview Worker and origin must be isolated from production.');
  if (Object.keys(preview).sort().join(',') !== Object.keys(production).sort().join(','))
    throw new Error('Preview bindings must explicitly match every production binding.');
  for (const [name, value] of Object.entries(production))
    assertBindingIsolation(name, value, preview[name]);
  return preview;
}
function wranglerBindings(values: Bindings): Record<string, unknown> {
  const analytics_engine_datasets = [];
  const ratelimits = [];
  for (const [name, value] of Object.entries(values)) {
    if (value.type === 'analytics-engine-dataset')
      analytics_engine_datasets.push({ binding: name, dataset: value.name });
    if (value.type === 'rate-limit')
      ratelimits.push({ name, namespace_id: value.namespace, simple: value.simple });
    // Secrets belong to the target Worker; names declare requirements but never copy values.
  }
  return { analytics_engine_datasets, ratelimits };
}
async function copyModules(
  source: string,
  destination: string,
  modules: Record<string, { type: 'esm' }>,
): Promise<void> {
  const root = await realpath(source);
  for (const file of Object.keys(modules)) {
    const from = path.join(source, file);
    const canonical = await realpath(from);
    if (!canonical.startsWith(`${root}${path.sep}`) || !(await lstat(from)).isFile())
      throw new Error('Compiled Worker modules must be regular files inside their bundle.');
    const to = path.join(destination, file);
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to);
  }
}
function workerConfiguration(
  built: z.infer<typeof descriptor>,
  config: WorkerReleaseConfiguration,
  preview: Bindings,
): Record<string, unknown> {
  return {
    name: config.productionWorker,
    main: '.wrangler/worker/index.js',
    compatibility_date: built.compatibilityDate,
    compatibility_flags: built.compatibilityFlags ?? [],
    observability: built.observability
      ? {
          enabled: built.observability.enabled,
          head_sampling_rate: built.observability.headSamplingRate,
        }
      : undefined,
    workers_dev: false,
    preview_urls: true,
    routes: [{ pattern: new URL(config.productionUrl).hostname, custom_domain: true }],
    vars: { LVBT_DEPLOYMENT_ENV: 'production' },
    ...wranglerBindings(built.env),
    env: {
      preview: {
        name: config.previewWorker,
        routes: [{ pattern: new URL(config.previewUrl).hostname, custom_domain: true }],
        vars: { LVBT_DEPLOYMENT_ENV: 'preview' },
        ...wranglerBindings(preview),
      },
    },
  };
}
export async function packageWorkerCfRelease(
  source: string,
  destination: string,
  identity: { commit: string; releaseId: string },
  config: WorkerReleaseConfiguration,
): Promise<WebsiteRelease> {
  identity = configuredReleaseIdentity(identity, config);
  const directory = path.join(source, '.cloudflare/output/v0/workers/default');
  const file = path.join(directory, 'worker.config.json');
  if (!(await lstat(file)).isFile()) throw new Error('Worker descriptor must be a regular file.');
  const built = descriptor.parse(JSON.parse(await readFile(file, 'utf8')));
  if (
    built.name !== config.productionWorker ||
    !built.domains.includes(new URL(config.productionUrl).hostname)
  )
    throw new Error('Built Worker does not match the configured production Worker and origin.');
  if (!built.manifest.modules[built.manifest.mainModule])
    throw new Error('Compiled Worker manifest is missing its main module.');
  const preview = previewBindings(built.env, config);
  await mkdir(destination, { recursive: false });
  try {
    await copyModules(
      path.join(directory, 'bundle'),
      path.join(destination, '.wrangler/worker/bundle'),
      built.manifest.modules,
    );
    await writeFile(
      path.join(destination, '.wrangler/worker/index.js'),
      workerReleaseEntry(`./bundle/${built.manifest.mainModule}`, identity, config),
    );
    await writeFile(path.join(destination, 'lvbt-release.json'), `${JSON.stringify(identity)}\n`);
    await writeFile(
      path.join(destination, 'wrangler.jsonc'),
      `${JSON.stringify(workerConfiguration(built, config, preview), null, 2)}\n`,
    );
    // Preserve binding declarations for review without materializing secret values.
    await writeFile(
      path.join(destination, 'worker-bindings.json'),
      `${JSON.stringify({ production: built.env, preview }, null, 2)}\n`,
    );
    return await sealSavedRelease(destination, identity, 'worker', 2);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
