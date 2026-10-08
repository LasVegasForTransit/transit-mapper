import { z } from 'zod';
import { verifyExpectedProductionVersion } from './expected-production-version.js';
import { releaseMarkerPath } from './release-path.js';
import {
  readReleaseIdentity,
  releaseIdentitySchema,
  type ReleaseIdentity,
} from './release-identity.js';
import type { ReleaseConfiguration } from './release-config.js';

const legacyMarkerSchema = z.strictObject({
  formatVersion: z.literal(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  commit: z.string().regex(/^[a-f0-9]{40}$/u),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const baselineEvidenceSchema = z.strictObject({
  kind: z.literal('provider-version'),
  version: z.uuid(),
  markerStatus: z.enum(['legacy', 'missing', 'nonmarker']),
  legacyMarker: legacyMarkerSchema.nullable(),
});
export type BaselineEvidence = z.infer<typeof baselineEvidenceSchema>;
type Configuration = Pick<
  ReleaseConfiguration,
  'productionWorker' | 'productionUrl' | 'publicPath' | 'profile'
>;
interface Dependencies {
  request?: typeof fetch;
  verifyVersion?: typeof verifyExpectedProductionVersion;
}
function evidence(version: string, value: unknown, missing: boolean): BaselineEvidence {
  const legacy = legacyMarkerSchema.safeParse(value);
  return {
    kind: 'provider-version',
    version,
    markerStatus: legacy.success ? 'legacy' : missing ? 'missing' : 'nonmarker',
    legacyMarker: legacy.success ? legacy.data : null,
  };
}
async function marker(config: Configuration, request: typeof fetch) {
  const response = await request(`${config.productionUrl}${releaseMarkerPath(config.publicPath)}`, {
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return { missing: true, value: null };
  if (response.status !== 200)
    throw new Error(`Production baseline marker unavailable (${response.status}).`);
  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    value = null;
  }
  return { missing: false, value };
}

/** Legacy evidence is permitted only with an explicit authenticated current-version precondition. */
export async function readProductionBaseline(
  config: Configuration,
  expectedVersion?: string,
  dependencies: Dependencies = {},
): Promise<{ identity: ReleaseIdentity | null; evidence?: BaselineEvidence }> {
  if (!expectedVersion)
    return {
      identity: await readReleaseIdentity(config.productionUrl, {
        publicPath: config.publicPath,
        app: config.profile,
        ...(dependencies.request ? { request: dependencies.request } : {}),
      }),
    };
  await (dependencies.verifyVersion ?? verifyExpectedProductionVersion)(config, expectedVersion);
  const result = await marker(config, dependencies.request ?? fetch);
  const identity = releaseIdentitySchema.safeParse(result.value);
  if (identity.success) {
    if (identity.data.app !== config.profile)
      throw new Error('Production baseline belongs to another app.');
    return { identity: identity.data };
  }
  const retained = evidence(expectedVersion, result.value, result.missing);
  if (retained.legacyMarker && config.profile && retained.legacyMarker.slug !== config.profile)
    throw new Error('Legacy production baseline belongs to another app.');
  return { identity: null, evidence: retained };
}
