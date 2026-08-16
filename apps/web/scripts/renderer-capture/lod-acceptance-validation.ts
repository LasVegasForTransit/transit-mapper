/**
 * The top-level Phase 2 evidence contract. Its three sections have separate
 * validators because a capture can be visually complete yet still carry stale
 * source provenance or an unverifiable interaction claim.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RendererCaptureManifest } from './capture-types';
import { assertionErrors } from './lod-acceptance-assertions';
import type { RendererLodAcceptanceManifest } from './lod-acceptance-types';
import { record, sameSource, validSource } from './lod-acceptance-validation-primitives';
import { visualErrors } from './lod-acceptance-visuals';

function headerErrors(candidate: Record<string, unknown>): string[] {
  return candidate.schemaVersion === 1 &&
    candidate.suiteId === 'phase-2-lod' &&
    candidate.phase === '01-lod' &&
    candidate.basemap === 'local-blank-v2' &&
    typeof candidate.generatedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.generatedAt))
    ? []
    : ['Acceptance manifest header is invalid.'];
}

/** Returns every integrity defect so a failed capture is diagnostic rather
 * than silently omitted from canonical renderer history. */
export async function validateRendererLodAcceptanceManifest(
  manifest: unknown,
  acceptanceDirectory: string,
  expectedSource: RendererCaptureManifest['source'],
): Promise<string[]> {
  const candidate = record(manifest);
  if (!candidate) return ['Acceptance manifest must be an object.'];
  const errors = headerErrors(candidate);
  if (!validSource(candidate.source) || !sameSource(candidate.source, expectedSource)) {
    errors.push('Acceptance source provenance must match the parent renderer manifest.');
  }
  if (!Array.isArray(candidate.visuals)) {
    errors.push('Acceptance visuals must be an array.');
  } else {
    errors.push(...(await visualErrors(candidate.visuals, acceptanceDirectory)));
  }
  if (!Array.isArray(candidate.assertions)) {
    errors.push('Acceptance assertions must be an array.');
  } else {
    errors.push(...assertionErrors(candidate.assertions));
  }
  return errors;
}

export async function loadValidRendererLodAcceptanceManifest(
  acceptanceDirectory: string,
  expectedSource: RendererCaptureManifest['source'],
): Promise<RendererLodAcceptanceManifest | undefined> {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(acceptanceDirectory, 'manifest.json'), 'utf8'),
    ) as unknown;
    return (
      await validateRendererLodAcceptanceManifest(manifest, acceptanceDirectory, expectedSource)
    ).length === 0
      ? (manifest as RendererLodAcceptanceManifest)
      : undefined;
  } catch {
    return undefined;
  }
}
