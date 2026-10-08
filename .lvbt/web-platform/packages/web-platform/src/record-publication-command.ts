import {
  readProductionBaseline,
  baselineEvidenceSchema,
  type BaselineEvidence,
} from './publication-baseline.js';
import { productionEndpoint } from './release-path.js';
import type { ReleaseConfiguration } from './release-config.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { type ReleaseIdentity } from './release-identity.js';
import { publicationReceipt } from './publication.js';

function selectedIdentity(
  config: ReleaseConfiguration,
  commit: string,
  releaseId: string,
): ReleaseIdentity {
  return { commit, releaseId, ...(config.profile ? { app: config.profile } : {}) };
}
async function savedBaseline(
  file: string,
): Promise<{ baseline: ReleaseIdentity | null; baselineEvidence?: BaselineEvidence }> {
  let baseline: ReleaseIdentity | null = null;
  let baselineEvidence: BaselineEvidence | undefined;
  try {
    const stored = JSON.parse(await readFile(file, 'utf8')) as {
      identity?: ReleaseIdentity | null;
      evidence?: unknown;
      releaseId?: string;
      commit?: string;
    };
    baseline = stored.identity ?? (stored.releaseId ? (stored as ReleaseIdentity) : null);
    if (stored.evidence) baselineEvidence = baselineEvidenceSchema.parse(stored.evidence);
  } catch {
    /* Baseline step may have failed; still retain the outcome. */
  }
  return { baseline, ...(baselineEvidence ? { baselineEvidence } : {}) };
}
export async function runPublication(
  config: ReleaseConfiguration,
  args: string[] = process.argv.slice(2),
): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      directory: { type: 'string' },
      'expected-version': { type: 'string' },
      commit: { type: 'string' },
      'release-id': { type: 'string' },
      'artifact-hash': { type: 'string' },
      version: { type: 'string' },
      activation: { type: 'string' },
      verification: { type: 'string' },
    },
  });
  if (!values.directory) throw new Error('Pass --directory.');
  await mkdir(values.directory, { recursive: true });
  const baselinePath = path.join(values.directory, 'baseline.json');
  if (positionals[0] === 'baseline') {
    const baseline = await readProductionBaseline(config, values['expected-version']);
    await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  } else if (positionals[0] === 'record') {
    if (!values.commit || !values['release-id']) throw new Error('Pass --commit and --release-id.');
    const { baseline, baselineEvidence } = await savedBaseline(baselinePath);
    const receipt = publicationReceipt({
      url: productionEndpoint(config),
      release: selectedIdentity(config, values.commit, values['release-id']),
      baseline,
      ...(baselineEvidence ? { baselineEvidence } : {}),
      artifactHash: values['artifact-hash'],
      version: values.version,
      activation: values.activation ?? '',
      verification: values.verification ?? '',
    });
    await writeFile(
      path.join(values.directory, 'publication.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary)
      await writeFile(
        summary,
        `### Website publication receipt\n\nRelease: ${receipt.release.releaseId}\n\nCommit: ${receipt.release.commit}\n\nBaseline: ${receipt.baseline?.releaseId ?? 'unavailable'}\n\nArtifact SHA-256: ${receipt.artifactHash ?? 'unavailable'}\n\nWorker version: ${receipt.version ?? 'unavailable'}\n\nActivation: ${receipt.activation}\n\nPublic verification: ${receipt.verification}\n\nPublic site: ${receipt.url}\n`,
        { flag: 'a' },
      );
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } else throw new Error('Use baseline or record.');
}
