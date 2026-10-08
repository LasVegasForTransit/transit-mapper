import { z } from 'zod';
import { releaseMarkerAssets } from './release-marker-assets.js';
import type { ReleaseConfiguration } from './release-config.js';
import {
  isolatedPreviewBindings,
  workerBindingsSchema,
  wranglerBindings,
  type WorkerBindings,
} from './worker-bindings.js';
const trigger = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('fetch'), pattern: z.string(), zone: z.string() }),
  z.strictObject({ type: z.literal('scheduled'), schedule: z.string() }),
]);
const worker = z.strictObject({
  name: z.string(),
  entrypoint: z.string(),
  compatibilityDate: z.string(),
  compatibilityFlags: z.array(z.string()).optional(),
  observability: z.record(z.string(), z.unknown()).optional(),
  logpush: z.boolean().optional(),
  tailConsumers: z.array(z.record(z.string(), z.unknown())).optional(),
  assets: z
    .strictObject({
      htmlHandling: z.string().optional(),
      notFoundHandling: z.string().optional(),
      runWorkerFirst: z.union([z.boolean(), z.array(z.string())]).optional(),
    })
    .optional(),
  triggers: z.array(trigger).default([]),
  domains: z.array(z.string()).default([]),
  exports: z
    .record(
      z.string(),
      z.strictObject({ type: z.literal('durable-object'), storage: z.literal('sqlite') }),
    )
    .optional(),
  env: workerBindingsSchema,
  workersDev: z.boolean().optional(),
  previewUrls: z.boolean().optional(),
  unsafe: z
    .strictObject({
      metadata: z.strictObject({ keep_bindings: z.array(z.enum(['secret_text', 'secret_key'])) }),
    })
    .optional(),
});
function snakeSettings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeSettings);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        snakeSettings(child),
      ]),
    );
  return value;
}
export async function resolveTypedConfiguration(input: unknown, preview = false): Promise<unknown> {
  const value: unknown = await input;
  if (typeof value !== 'function') return value;
  const factory = z
    .custom<(context: { mode: string; isPreview: boolean }) => unknown>(
      (candidate) => typeof candidate === 'function',
    )
    .parse(value);
  return await factory({ mode: preview ? 'preview' : 'production', isPreview: preview });
}
function durableNamespaces(
  built: z.infer<typeof worker>,
  preview: WorkerBindings,
  config: ReleaseConfiguration,
): void {
  for (const [name, value] of Object.entries(built.env)) {
    if (value.type !== 'durable-object') continue;
    const candidate = preview[name];
    if (
      value.worker !== config.productionWorker ||
      candidate?.type !== 'durable-object' ||
      candidate.worker !== config.previewWorker ||
      !built.exports?.[value.exportName]
    )
      throw new Error(
        'Durable Object namespace must retain its declared class on the selected production or preview Worker.',
      );
  }
}
const canonical = z.strictObject({
  worker,
  accountId: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional(),
});
function matchesPublicRoute(built: z.infer<typeof worker>, config: ReleaseConfiguration): boolean {
  const hostname = new URL(config.productionUrl).hostname;
  const prefix = config.publicPath ?? '/';
  if (prefix !== '/' && built.domains.includes(hostname)) return false;
  if (prefix === '/' && built.domains.includes(hostname)) return true;
  const routePrefix = hostname + prefix;
  return built.triggers.some(
    (item) =>
      item.type === 'fetch' &&
      (item.pattern === routePrefix.slice(0, -1) || item.pattern.startsWith(routePrefix)),
  );
}
function canonicalWorkers(value: unknown, config: ReleaseConfiguration, previewValue: unknown) {
  const built = canonical.parse(value).worker;
  const candidate = previewValue === undefined ? built : canonical.parse(previewValue).worker;
  if (previewValue !== undefined && candidate.name !== config.previewWorker)
    throw new Error('Canonical preview config does not identify the configured preview Worker.');
  if (built.name !== config.productionWorker)
    throw new Error('Canonical config does not identify the configured production Worker.');
  if (!config.previewOnly && !matchesPublicRoute(built, config))
    throw new Error(
      'Canonical routes do not identify the configured production origin and public path.',
    );
  return { built, candidate };
}
function workerAssets(
  value: z.infer<typeof canonical>['worker']['assets'],
  binding: string | undefined,
  publicPath: string | undefined,
): Record<string, unknown> | undefined {
  return value
    ? releaseMarkerAssets(
        { ...(snakeSettings(value) as Record<string, unknown>), binding },
        publicPath,
      )
    : undefined;
}
export function typedWorkerConfiguration(
  value: unknown,
  config: ReleaseConfiguration,
  previewValue?: unknown,
): Record<string, unknown> {
  const { built, candidate } = canonicalWorkers(value, config, previewValue);
  const preview = isolatedPreviewBindings(
    built.env,
    config.previewBindings,
    config.previewReadOnlyBindings,
  );
  durableNamespaces(built, preview, config);
  const assetNames = Object.entries(built.env)
    .filter(([, binding]) => binding.type === 'assets')
    .map(([name]) => name);
  if (assetNames.length > 1 || Boolean(built.assets) !== Boolean(assetNames.length))
    throw new Error('Declare one assets binding with its canonical asset settings.');
  const assets = workerAssets(built.assets, assetNames[0], config.publicPath);
  const previewAssets = workerAssets(candidate.assets, assetNames[0], config.publicPath);
  const unsafe = built.unsafe ?? { metadata: { keep_bindings: ['secret_text', 'secret_key'] } };
  const productionBindings = wranglerBindings(built.env);
  const previewBindings = wranglerBindings(preview);
  return {
    account_id: canonical.parse(value).accountId,
    name: built.name,
    main: built.entrypoint,
    compatibility_date: built.compatibilityDate,
    compatibility_flags: built.compatibilityFlags ?? [],
    observability: snakeSettings(built.observability),
    logpush: built.logpush,
    tail_consumers: snakeSettings(built.tailConsumers),
    workers_dev: built.workersDev ?? false,
    preview_urls: config.publicationMode !== 'named-staging',
    assets,
    exports: built.exports,
    routes: [
      ...built.domains.map((domain) => ({ pattern: domain, custom_domain: true })),
      ...built.triggers.flatMap((item) =>
        item.type === 'fetch' ? [{ pattern: item.pattern, zone_name: item.zone }] : [],
      ),
    ],
    triggers: {
      crons: built.triggers.flatMap((item) => (item.type === 'scheduled' ? [item.schedule] : [])),
    },
    ...productionBindings,
    vars: {
      ...(productionBindings.vars as Record<string, unknown>),
      LVBT_DEPLOYMENT_ENV: 'production',
    },
    unsafe,
    env: {
      preview: {
        name: config.previewWorker,
        assets: previewAssets,
        observability: snakeSettings(candidate.observability),
        logpush: candidate.logpush,
        tail_consumers: previewValue === undefined ? [] : snakeSettings(candidate.tailConsumers),
        unsafe: candidate.unsafe ?? unsafe,
        workers_dev: new URL(config.previewUrl).hostname.endsWith('.workers.dev'),
        preview_urls: config.publicationMode !== 'named-staging',
        routes: new URL(config.previewUrl).hostname.endsWith('.workers.dev')
          ? []
          : [{ pattern: new URL(config.previewUrl).hostname, custom_domain: true }],
        triggers: { crons: [] },
        ...previewBindings,
        vars: {
          ...(previewBindings.vars as Record<string, unknown>),
          LVBT_DEPLOYMENT_ENV: 'preview',
        },
      },
    },
  };
}
