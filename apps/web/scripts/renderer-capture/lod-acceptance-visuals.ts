/** Validates the immutable visual appendix: case IDs, declared paths,
 * fixture/camera provenance, and the bytes written to each image file. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RENDERER_LOD_ACCEPTANCE_VISUAL_CASES } from '../../src/perf/renderer-lod-acceptance';
import { rendererCaptureDigest } from './lifecycle';
import {
  exactIdSet,
  record,
  SHA_256,
  validCamera,
  validFixture,
  validMovingCamera,
  validStats,
} from './lod-acceptance-validation-primitives';

interface ExpectedVisual {
  readonly id: string;
  readonly file: string;
  readonly fixtureId: string;
  readonly surface: string;
  readonly state: string;
  readonly camera: unknown;
}

interface VisualProvenance {
  readonly fixtureId: unknown;
  readonly surface: unknown;
  readonly state: unknown;
  readonly fixture: unknown;
  readonly camera: unknown;
  readonly rendererStats: unknown;
}

function matchesExpectedVisual(entry: Record<string, unknown>, expected: ExpectedVisual): boolean {
  const provenance: VisualProvenance = {
    fixtureId: entry.fixtureId,
    surface: entry.surface,
    state: entry.state,
    fixture: entry.fixture,
    camera: entry.camera,
    rendererStats: entry.rendererStats,
  };
  return (
    provenance.fixtureId === expected.fixtureId &&
    provenance.surface === expected.surface &&
    provenance.state === expected.state &&
    validFixture(provenance.fixture, expected.fixtureId) &&
    (expected.state === 'moving'
      ? validMovingCamera(provenance.camera, expected.camera as never)
      : validCamera(provenance.camera, expected.camera as never)) &&
    validStats(provenance.rendererStats)
  );
}

async function digestError(
  entry: Record<string, unknown>,
  expected: ExpectedVisual,
  acceptanceDirectory: string,
): Promise<string | null> {
  if (typeof entry.sha256 !== 'string' || !SHA_256.test(entry.sha256)) {
    return `Acceptance visual ${expected.id} has an invalid SHA-256 digest.`;
  }
  try {
    const bytes = await readFile(resolve(acceptanceDirectory, expected.file));
    return rendererCaptureDigest(bytes) === entry.sha256
      ? null
      : `Acceptance visual ${expected.id} hash does not match its file.`;
  } catch {
    return `Acceptance visual ${expected.id} file is missing.`;
  }
}

/** Returns all evidence defects so a stale or partial appendix is actionable. */
export async function visualErrors(
  visuals: unknown[],
  acceptanceDirectory: string,
): Promise<string[]> {
  const errors: string[] = [];
  const expectedVisuals = RENDERER_LOD_ACCEPTANCE_VISUAL_CASES;
  if (
    !exactIdSet(
      visuals,
      expectedVisuals.map((entry) => entry.id),
    )
  ) {
    errors.push('Acceptance visuals must contain the exact 21-case ID set.');
  }
  const expectedById = new Map(expectedVisuals.map((entry) => [entry.id, entry]));
  const seenFiles = new Set<string>();
  for (const raw of visuals) {
    const entry = record(raw);
    const id = typeof entry?.id === 'string' ? entry.id : '<invalid>';
    const expected = expectedById.get(id);
    if (!entry || !expected) continue;
    if (entry.file !== expected.file || seenFiles.has(entry.file)) {
      errors.push(`Acceptance visual ${id} must use its declared images path.`);
      continue;
    }
    seenFiles.add(expected.file);
    if (!matchesExpectedVisual(entry, expected)) {
      errors.push(`Acceptance visual ${id} has invalid capture provenance.`);
      continue;
    }
    const error = await digestError(entry, expected, acceptanceDirectory);
    if (error) errors.push(error);
  }
  return errors;
}
