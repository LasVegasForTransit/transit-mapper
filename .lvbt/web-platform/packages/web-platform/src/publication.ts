import { baselineEvidenceSchema, type BaselineEvidence } from './publication-baseline.js';
import { z } from 'zod';
import type { ReleaseIdentity } from './release-identity.js';

export const publicationSchema = z.object({
  release: z.object({
    app: z.string().optional(),
    releaseId: z.string().regex(/^[1-9][0-9]*$/),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
  }),
  baseline: z
    .object({ releaseId: z.string(), commit: z.string(), app: z.string().optional() })
    .nullable(),
  baselineEvidence: baselineEvidenceSchema.optional(),
  artifactHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  version: z.uuid().nullable(),
  activation: z.enum(['confirmed', 'unknown', 'not-attempted']),
  verification: z.enum(['success', 'failure', 'skipped', 'cancelled']),
  url: z.url({ protocol: /^https$/ }),
  recordedAt: z.string(),
});
export function publicationReceipt(input: {
  release: ReleaseIdentity;
  baseline: ReleaseIdentity | null;
  baselineEvidence?: BaselineEvidence | undefined;
  artifactHash?: string | undefined;
  version?: string | undefined;
  activation: string;
  verification: string;
  url?: string;
}) {
  return publicationSchema.parse({
    ...input,
    artifactHash: input.artifactHash === '' ? null : (input.artifactHash ?? null),
    version: input.version === '' ? null : (input.version ?? null),
    activation:
      input.activation === 'success'
        ? 'confirmed'
        : ['skipped', ''].includes(input.activation)
          ? 'not-attempted'
          : 'unknown',
    verification: input.verification || 'skipped',
    url: input.url ?? 'https://lasvegasfortransit.org',
    recordedAt: new Date().toISOString(),
  });
}
