import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { z } from 'zod';
import { verifyReadOnlyWorkerModules } from './read-only-worker-modules.js';
const databases = z.array(
  z
    .object({
      binding: z.string(),
      database_id: z
        .string()
        .min(1)
        .refine(
          (id) => id !== '00000000-0000-0000-0000-000000000000',
          'Initialize the selected D1 database before releasing.',
        ),
    })
    .loose(),
);
const buckets = z.array(z.object({ binding: z.string(), bucket_name: z.string().min(1) }).loose());
const durableObjects = z
  .object({
    bindings: z.array(
      z
        .object({ name: z.string(), class_name: z.string(), script_name: z.string().optional() })
        .loose(),
    ),
  })
  .loose();
const counters = z.array(
  z
    .object({
      name: z.string(),
      namespace_id: z.string().regex(/^\d+$/),
      simple: z.object({ limit: z.number(), period: z.number() }).loose(),
    })
    .loose(),
);
const workerConfiguration = z
  .object({
    name: z.string(),
    durable_objects: durableObjects.optional(),
    ratelimits: counters.optional(),
    d1_databases: databases.optional(),
    r2_buckets: buckets.optional(),
    env: z
      .object({
        preview: z
          .object({
            name: z.string().optional(),
            durable_objects: durableObjects.optional(),
            ratelimits: counters.optional(),
            d1_databases: databases.optional(),
            r2_buckets: buckets.optional(),
            triggers: z.object({ crons: z.array(z.string()) }).optional(),
          })
          .loose(),
      })
      .loose(),
  })
  .loose();
function assertDurableObjectNamespaces(
  config: z.infer<typeof workerConfiguration>,
  expected: { productionWorker: string; previewWorker: string },
): void {
  const production = config.durable_objects?.bindings ?? [];
  const preview = config.env.preview.durable_objects?.bindings ?? [];
  for (const value of production) {
    const candidate = preview.find((entry) => entry.name === value.name);
    if (
      candidate?.class_name !== value.class_name ||
      (value.script_name ?? expected.productionWorker) !== expected.productionWorker ||
      (candidate.script_name ?? expected.previewWorker) !== expected.previewWorker
    )
      throw new Error(
        'Preview Durable Objects must retain the class and use the declared separate Worker namespace.',
      );
  }
}
function assertCounterNamespaces(config: z.infer<typeof workerConfiguration>): void {
  const productionCounters = config.ratelimits ?? [];
  const previewCounters = config.env.preview.ratelimits ?? [];
  for (const value of productionCounters) {
    const candidate = previewCounters.find((entry) => entry.name === value.name);
    if (
      candidate?.simple.limit !== value.simple.limit ||
      candidate.simple.period !== value.simple.period
    )
      throw new Error('Preview rate limits must retain the declared production behavior.');
  }
  if (
    previewCounters.some((candidate) =>
      productionCounters.some(
        (value) => BigInt(value.namespace_id) === BigInt(candidate.namespace_id),
      ),
    )
  )
    throw new Error('Preview rate limits must use separate account-scoped namespaces.');
}
export function assertWorkerReleaseConfiguration(
  value: unknown,
  expected: {
    productionWorker: string;
    previewWorker: string;
    previewReadOnlyBindings?: string[] | undefined;
  },
): void {
  const config = workerConfiguration.parse(value);
  if (
    config.name !== expected.productionWorker ||
    (config.env.preview.name ?? `${config.name}-preview`) !== expected.previewWorker
  )
    throw new Error('Reviewed configuration does not match the selected Worker namespaces.');
  assertDurableObjectNamespaces(config, expected);
  assertCounterNamespaces(config);
  const production = config.d1_databases ?? [];
  const preview = config.env.preview.d1_databases ?? [];
  if (
    production.some(
      (database) => !preview.some((candidate) => candidate.binding === database.binding),
    ) ||
    preview.some((database) =>
      production.some((candidate) => candidate.database_id === database.database_id),
    )
  )
    throw new Error('Preview D1 bindings must exist and use separate databases from production.');
  const readonly = expected.previewReadOnlyBindings ?? [];
  const productionBuckets = config.r2_buckets ?? [];
  const previewBuckets = config.env.preview.r2_buckets ?? [];
  if (
    productionBuckets.some(
      (bucket) => !previewBuckets.some((candidate) => candidate.binding === bucket.binding),
    ) ||
    previewBuckets.some((bucket) =>
      productionBuckets.some(
        (candidate) =>
          candidate.bucket_name === bucket.bucket_name &&
          !(readonly.includes(bucket.binding) && candidate.binding === bucket.binding),
      ),
    )
  )
    throw new Error('Preview R2 bindings must exist and use separate buckets from production.');
  if (config.env.preview.triggers?.crons.length)
    throw new Error('Preview releases cannot enable scheduled production jobs.');
}
export async function verifyWorkerReleaseConfiguration(
  directory: string,
  expected: {
    productionWorker: string;
    previewWorker: string;
    previewReadOnlyBindings?: string[] | undefined;
  },
): Promise<void> {
  const errors: ParseError[] = [];
  const value: unknown = parse(
    await readFile(path.join(directory, 'wrangler.jsonc'), 'utf8'),
    errors,
    { allowTrailingComma: true },
  );
  if (errors.length) throw new Error('Invalid reviewed Wrangler configuration.');
  assertWorkerReleaseConfiguration(value, expected);
  if (expected.previewReadOnlyBindings?.length) {
    await verifyReadOnlyWorkerModules(directory);
    const capabilities = z
      .strictObject({ readOnlyBindings: z.array(z.string()) })
      .parse(
        JSON.parse(
          await readFile(
            path.join(directory, '.wrangler/worker/preview-capabilities.json'),
            'utf8',
          ),
        ),
      );
    if (
      JSON.stringify([...capabilities.readOnlyBindings].sort()) !==
      JSON.stringify([...expected.previewReadOnlyBindings].sort())
    )
      throw new Error('Saved preview read-only capabilities differ from the reviewed policy.');
  }
}
