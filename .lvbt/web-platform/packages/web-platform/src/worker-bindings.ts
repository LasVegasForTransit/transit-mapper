import { z } from 'zod';
const simple = z.strictObject({
  limit: z.number().int().positive(),
  period: z.union([z.literal(10), z.literal(60)]),
});
const binding = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('d1'),
    name: z.string().min(1),
    id: z
      .string()
      .min(1)
      .refine(
        (id) => id !== '00000000-0000-0000-0000-000000000000',
        'Initialize the selected D1 database before releasing.',
      ),
  }),
  z.strictObject({ type: z.literal('r2'), name: z.string().min(1) }),
  z.strictObject({
    type: z.literal('durable-object'),
    worker: z.string().min(1),
    exportName: z.string().min(1),
  }),
  z.strictObject({ type: z.literal('analytics-engine-dataset'), name: z.string().min(1) }),
  z.strictObject({ type: z.literal('rate-limit'), namespace: z.string().regex(/^\d+$/), simple }),
  z.strictObject({ type: z.literal('text'), value: z.string() }),
  z.strictObject({ type: z.literal('assets') }),
  z.strictObject({ type: z.literal('secret') }),
]);
export const workerBindingsSchema = z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), binding);
export type WorkerBindings = z.infer<typeof workerBindingsSchema>;
function isolated(value: WorkerBindings[string], candidate: WorkerBindings[string]): boolean {
  if (value.type !== candidate.type) return false;
  if (value.type === 'd1' && candidate.type === 'd1')
    return value.id !== candidate.id && value.name !== candidate.name;
  if (value.type === 'r2' && candidate.type === 'r2') return value.name !== candidate.name;
  if (value.type === 'durable-object' && candidate.type === 'durable-object')
    return value.worker !== candidate.worker && value.exportName === candidate.exportName;
  if (value.type === 'analytics-engine-dataset' && candidate.type === 'analytics-engine-dataset')
    return value.name !== candidate.name;
  if (value.type === 'rate-limit' && candidate.type === 'rate-limit')
    return (
      BigInt(value.namespace) !== BigInt(candidate.namespace) &&
      JSON.stringify(value.simple) === JSON.stringify(candidate.simple)
    );
  return true;
}
export function isolatedPreviewBindings(
  production: WorkerBindings,
  input: unknown,
  readonlyBindings: string[] = [],
): WorkerBindings {
  const preview = workerBindingsSchema.parse(input);
  if (Object.keys(preview).sort().join(',') !== Object.keys(production).sort().join(','))
    throw new Error('Declare every isolated preview binding explicitly.');
  if (new Set(readonlyBindings).size !== readonlyBindings.length)
    throw new Error('Duplicate preview read-only bindings.');
  for (const name of readonlyBindings) {
    const value = production[name],
      candidate = preview[name];
    if (value?.type !== 'r2' || candidate?.type !== 'r2' || value.name !== candidate.name)
      throw new Error('Preview read-only capabilities require an explicitly shared R2 binding.');
  }
  for (const [name, value] of Object.entries(production)) {
    const candidate = preview[name];
    if (!candidate || (!readonlyBindings.includes(name) && !isolated(value, candidate)))
      throw new Error(`Preview binding ${name} must retain its type and use isolated resources.`);
  }
  return preview;
}
export function wranglerBindings(values: WorkerBindings): Record<string, unknown> {
  return {
    durable_objects: {
      bindings: Object.entries(values).flatMap(([name, value]) =>
        value.type === 'durable-object'
          ? [{ name, class_name: value.exportName, script_name: value.worker }]
          : [],
      ),
    },
    vars: Object.fromEntries(
      Object.entries(values).flatMap(([name, value]) =>
        value.type === 'text' ? [[name, value.value]] : [],
      ),
    ),
    d1_databases: Object.entries(values).flatMap(([name, value]) =>
      value.type === 'd1'
        ? [{ binding: name, database_name: value.name, database_id: value.id }]
        : [],
    ),
    r2_buckets: Object.entries(values).flatMap(([name, value]) =>
      value.type === 'r2' ? [{ binding: name, bucket_name: value.name }] : [],
    ),
    analytics_engine_datasets: Object.entries(values).flatMap(([name, value]) =>
      value.type === 'analytics-engine-dataset' ? [{ binding: name, dataset: value.name }] : [],
    ),
    ratelimits: Object.entries(values).flatMap(([name, value]) =>
      value.type === 'rate-limit'
        ? [{ name, namespace_id: value.namespace, simple: value.simple }]
        : [],
    ),
  };
}
