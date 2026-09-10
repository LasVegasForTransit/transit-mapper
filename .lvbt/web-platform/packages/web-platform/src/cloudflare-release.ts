import { z } from 'zod';

export function verifyArchiveVersion(input: unknown, version: string): void {
  const schema = z.object({
    id: z.literal(version),
    resources: z.object({
      bindings: z.tuple([z.object({ name: z.literal('ASSETS'), type: z.literal('assets') })]),
    }),
  });
  if (!schema.safeParse(input).success)
    throw new Error('The archive version must expose only its ASSETS binding, without secrets.');
}

const deployments = z.array(
  z.object({
    created_on: z.iso.datetime({ offset: true }),
    versions: z
      .array(z.object({ version_id: z.uuid(), percentage: z.number().min(0).max(100) }))
      .min(1),
  }),
);

export function activeVersion(input: unknown): string | null {
  const latest = deployments
    .parse(input)
    .sort((left, right) => Date.parse(right.created_on) - Date.parse(left.created_on))[0];
  if (latest === undefined) return null;
  const version = latest.versions[0];
  if (latest.versions.length !== 1 || version?.percentage !== 100) {
    throw new Error('A traffic split requires explicit rollout management before deployment.');
  }
  return version.version_id;
}

const upload = z.object({
  type: z.literal('deploy'),
  version: z.literal(1),
  worker_name: z.string(),
  version_id: z.uuid(),
});

export function uploadedVersion(output: string, worker: string): string {
  const records = output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => upload.safeParse(JSON.parse(line)));
  const matches = records.flatMap((record) =>
    record.success && record.data.worker_name === worker ? [record.data] : [],
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`Expected one structured deployment receipt for ${worker}.`);
  }
  return matches[0].version_id;
}
