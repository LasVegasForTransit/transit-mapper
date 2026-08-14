import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import sharp from 'sharp';
import {
  createRendererCapturePlan,
  createRendererContextPlan,
  createRendererFilmstripPlan,
  rendererCaptureComparisons,
  rendererCaptureFilename,
  rendererContextFilename,
  rendererFilmstripFilename,
  rendererFixtureFilename,
  type RendererCaptureComparison,
} from '../../src/perf/renderer-capture';
import { RENDERER_FIXTURE_DESCRIPTORS } from '../../src/perf/renderer-fixtures';
import type { RendererCaptureCliOptions } from './cli';
import {
  rendererContactSheetHtml,
  type RendererContactSheetAppendix,
  type RendererContactSheetCapture,
} from './contact-sheet';
import type { RendererCaptureManifestEntry } from './capture-types';
import { rendererCaptureDigest } from './lifecycle';
import { loadValidRendererLodAcceptanceManifest } from './lod-acceptance-validation';
import type { RendererLodAcceptanceManifest } from './lod-acceptance-types';

const NUMBERED_PHASE = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA_256 = /^[a-f0-9]{64}$/;
const GIT_REVISION = /^[a-f0-9]{40}$/;

export interface RendererEvidenceFile {
  id: string;
  file: string;
}

export function completeRendererEvidenceFiles(phase: string): RendererEvidenceFile[] {
  return [
    ...createRendererCapturePlan(phase).map((capture) => ({
      id: capture.id,
      file: `images/${rendererCaptureFilename(capture)}`,
    })),
    ...createRendererFilmstripPlan(phase).map((capture) => ({
      id: capture.id,
      file: `images/${rendererFilmstripFilename(capture)}`,
    })),
    ...RENDERER_FIXTURE_DESCRIPTORS.map((descriptor) => ({
      id: `${phase}-fixture-${descriptor.id}`,
      file: `images/${rendererFixtureFilename(descriptor.id)}`,
    })),
    ...createRendererContextPlan(phase).map((capture) => ({
      id: capture.id,
      file: `images/${rendererContextFilename(capture)}`,
    })),
  ];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface CaptureManifestSourceHeader {
  revision: string;
  dirty: boolean;
  contentSha256?: string;
}

function hasAllProfileSelection(selection: unknown): boolean {
  if (!selection || typeof selection !== 'object') return false;
  const values = selection as Record<string, unknown>;
  return values.profile === 'all' && values.theme === 'all';
}

function sourceHeader(source: unknown): CaptureManifestSourceHeader | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const values = source as Record<string, unknown>;
  if (
    typeof values.revision !== 'string' ||
    !GIT_REVISION.test(values.revision) ||
    typeof values.dirty !== 'boolean'
  ) {
    return undefined;
  }
  return {
    revision: values.revision,
    dirty: values.dirty,
    ...(typeof values.contentSha256 === 'string' ? { contentSha256: values.contentSha256 } : {}),
  };
}

function hasContentDigest(
  source: CaptureManifestSourceHeader,
): source is Required<CaptureManifestSourceHeader> {
  return source.contentSha256 !== undefined && SHA_256.test(source.contentSha256);
}

function validBasemapHeader(
  basemap: unknown,
  phase: string,
  source: CaptureManifestSourceHeader,
): boolean {
  if (phase === '00-baseline') {
    return (
      basemap === 'local-blank-v1' || (basemap === 'local-blank-v2' && hasContentDigest(source))
    );
  }
  return basemap === 'local-blank-v2' && hasContentDigest(source);
}

function hasCompleteManifestHeader(candidate: Record<string, unknown>, phase: string): boolean {
  const source = sourceHeader(candidate.source);
  return (
    candidate.schemaVersion === 1 &&
    candidate.phase === phase &&
    candidate.complete === true &&
    hasAllProfileSelection(candidate.selection) &&
    source !== undefined &&
    validBasemapHeader(candidate.basemap, phase, source)
  );
}

function captureFile(
  capture: unknown,
  expected: Map<string, string>,
  seenFiles: Set<string>,
  phaseDirectory: string,
): { path: string; sha256: string } | undefined {
  if (!capture || typeof capture !== 'object') return undefined;
  const entry = capture as Record<string, unknown>;
  if (typeof entry.id !== 'string') return undefined;
  const expectedFile = expected.get(entry.id);
  if (!expectedFile || entry.file !== expectedFile) return undefined;
  if (seenFiles.has(expectedFile)) return undefined;
  if (typeof entry.sha256 !== 'string' || !SHA_256.test(entry.sha256)) return undefined;
  expected.delete(entry.id);
  seenFiles.add(expectedFile);
  return { path: resolve(phaseDirectory, expectedFile), sha256: entry.sha256 };
}

function completeManifestFiles(
  manifest: unknown,
  phase: string,
  phaseDirectory: string,
):
  | {
      files: Array<{ path: string; sha256: string }>;
      source: { revision: string; dirty: boolean; contentSha256: string } | undefined;
    }
  | undefined {
  if (!manifest || typeof manifest !== 'object') return undefined;
  const candidate = manifest as Record<string, unknown>;
  if (!hasCompleteManifestHeader(candidate, phase)) return undefined;
  if (!Array.isArray(candidate.captures)) return undefined;
  const expected = new Map(
    completeRendererEvidenceFiles(phase).map((entry) => [entry.id, entry.file]),
  );
  if (candidate.captures.length !== expected.size) return undefined;
  const files: Array<{ path: string; sha256: string }> = [];
  const seenFiles = new Set<string>();
  for (const capture of candidate.captures) {
    const file = captureFile(capture, expected, seenFiles, phaseDirectory);
    if (!file) return undefined;
    files.push(file);
  }
  if (expected.size !== 0) return undefined;
  const rawSource = sourceHeader(candidate.source);
  const source =
    rawSource && hasContentDigest(rawSource)
      ? {
          revision: rawSource.revision,
          dirty: rawSource.dirty,
          contentSha256: rawSource.contentSha256,
        }
      : undefined;
  return { files, source };
}

async function isSuccessfulPhase(root: string, phase: string): Promise<boolean> {
  if (!NUMBERED_PHASE.test(phase)) return false;
  const phaseDirectory = resolve(root, phase);
  if (await fileExists(resolve(phaseDirectory, 'capture-error.json'))) return false;
  try {
    const manifest = JSON.parse(
      await readFile(resolve(phaseDirectory, 'manifest.json'), 'utf8'),
    ) as unknown;
    const evidence = completeManifestFiles(manifest, phase, phaseDirectory);
    if (!evidence) return false;
    const valid = await Promise.all(
      evidence.files.map(async (file) => {
        const bytes = await readFile(file.path);
        return rendererCaptureDigest(bytes) === file.sha256;
      }),
    );
    if (!valid.every(Boolean)) return false;
    if (phase !== '01-lod') return true;
    if (!evidence.source) return false;
    return Boolean(
      await loadValidRendererLodAcceptanceManifest(
        resolve(phaseDirectory, 'acceptance'),
        evidence.source,
      ),
    );
  } catch {
    return false;
  }
}

function phaseOrdinal(phase: string): number | undefined {
  if (!NUMBERED_PHASE.test(phase)) return undefined;
  const ordinal = Number.parseInt(phase.slice(0, 2), 10);
  return Number.isFinite(ordinal) ? ordinal : undefined;
}

export function previousRendererPhase(
  currentPhase: string,
  successfulPhases: readonly string[],
): string | undefined {
  const currentOrdinal = phaseOrdinal(currentPhase);
  if (currentOrdinal === undefined) return undefined;
  return successfulPhases
    .filter((phase) => {
      const ordinal = phaseOrdinal(phase);
      return ordinal !== undefined && ordinal < currentOrdinal;
    })
    .sort()
    .at(-1);
}

export async function successfulRendererPhaseDirectories(
  outputDirectory: string,
): Promise<string[]> {
  const root = dirname(outputDirectory);
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const successful = await Promise.all(
    names.map(async (phase) => ({
      phase,
      valid:
        resolve(root, phase) !== resolve(outputDirectory) && (await isSuccessfulPhase(root, phase)),
    })),
  );
  return successful
    .filter((candidate) => candidate.valid)
    .map((candidate) => candidate.phase)
    .sort();
}

interface ComparisonOptions {
  entry: RendererCaptureManifestEntry;
  outputDirectory: string;
  baselinePhase?: string;
  previousPhase?: string;
  root: string;
  diffDirectory: string;
}

function rendererFixtureLabel(entry: RendererCaptureManifestEntry): string {
  if (entry.fixtureId === 'onboarding') return 'Onboarding';
  return (
    RENDERER_FIXTURE_DESCRIPTORS.find((descriptor) => descriptor.id === entry.fixtureId)?.label ??
    entry.fixtureId
  );
}

/** Human-readable camera provenance shown beside every visual comparison. */
export function rendererCaptureDescription(entry: RendererCaptureManifestEntry): string {
  const zoom = entry.zoom === null ? 'fitted camera' : `z${entry.zoom.toFixed(3)}`;
  const target =
    entry.targetCorridorWidthPx === undefined
      ? undefined
      : `${entry.targetCorridorWidthPx.toFixed(2).replace(/\.?0+$/, '')} px target`;
  const viewport = `${entry.viewport.width}×${entry.viewport.height} @${entry.viewport.pixelRatio}x`;
  return [
    rendererFixtureLabel(entry),
    `${entry.profile}/${entry.theme}/${entry.viewMode}/${entry.detail}`,
    zoom,
    target,
    viewport,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
}

export function rendererLodAcceptanceContactSheetAppendix(
  manifest: RendererLodAcceptanceManifest,
): RendererContactSheetAppendix {
  return {
    title: 'LOD acceptance',
    suiteId: manifest.suiteId,
    manifestPath: 'acceptance/manifest.json',
    visuals: manifest.visuals.map((entry) => {
      const target =
        entry.camera.targetCorridorWidthPx === undefined
          ? undefined
          : `${entry.camera.targetCorridorWidthPx.toFixed(2).replace(/\.?0+$/, '')} px target`;
      return {
        id: entry.id,
        path: `acceptance/${entry.file}`,
        description: [
          entry.fixture.id,
          entry.surface,
          entry.state,
          `z${entry.camera.zoom.toFixed(3)}`,
          target,
          `${entry.camera.viewport.width}×${entry.camera.viewport.height} @${entry.camera.viewport.pixelRatio}x`,
          `renderer ${entry.rendererStats.projectionCount}/${entry.rendererStats.fullUploadCount}/${entry.rendererStats.sourceUploadCount}`,
        ]
          .filter((part): part is string => part !== undefined)
          .join(' · '),
      };
    }),
    assertions: manifest.assertions.map((assertion) => ({
      id: assertion.id,
      passed: assertion.passed,
      description:
        assertion.kind === 'renderer-stats'
          ? `committed Δ ${assertion.delta.projectionCount}/${assertion.delta.fullUploadCount}/${assertion.delta.sourceUploadCount}; editor Δ ${assertion.delta.editorProjectionCount}/${assertion.delta.editorSourceUploadCount}`
          : `${assertion.before.visibleLayerIds[0] ?? 'unknown'} @ ${assertion.before.activeRevision} → ${assertion.afterPromotion.visibleLayerIds[0] ?? 'unknown'} @ ${assertion.afterPromotion.activeRevision}`,
    })),
  };
}

async function comparisonsForEntry({
  entry,
  outputDirectory,
  baselinePhase,
  previousPhase,
  root,
  diffDirectory,
}: ComparisonOptions): Promise<RendererCaptureComparison[]> {
  const currentPath = resolve(outputDirectory, entry.file);
  const filename = basename(entry.file);
  const baselinePath = baselinePhase ? resolve(root, baselinePhase, 'images', filename) : undefined;
  const previousPath = previousPhase ? resolve(root, previousPhase, 'images', filename) : undefined;
  let differencePath: string | undefined;
  if (baselinePath && (await fileExists(baselinePath))) {
    differencePath = resolve(diffDirectory, filename);
    await sharp(currentPath)
      .composite([{ input: baselinePath, blend: 'difference' }])
      .png()
      .toFile(differencePath);
  }
  const optionalRelativePath = async (path: string | undefined) =>
    path && (await fileExists(path)) ? relative(outputDirectory, path) : undefined;
  return rendererCaptureComparisons({
    baselinePath: await optionalRelativePath(baselinePath),
    previousPath: await optionalRelativePath(previousPath),
    currentPath: relative(outputDirectory, currentPath),
    differencePath: differencePath ? relative(outputDirectory, differencePath) : undefined,
  });
}

export async function buildRendererContactSheet(
  options: RendererCaptureCliOptions,
  entries: RendererCaptureManifestEntry[],
  lodAcceptance?: RendererLodAcceptanceManifest,
): Promise<void> {
  const root = dirname(options.outputDirectory);
  const phases = await successfulRendererPhaseDirectories(options.outputDirectory);
  const baselinePhase = phases.includes('00-baseline') ? '00-baseline' : undefined;
  const previousPhase = previousRendererPhase(options.phase, phases);
  const diffDirectory = resolve(options.outputDirectory, 'diff');
  await mkdir(diffDirectory, { recursive: true });
  const captures: RendererContactSheetCapture[] = [];
  for (const entry of entries) {
    captures.push({
      id: entry.id,
      description: rendererCaptureDescription(entry),
      comparisons: await comparisonsForEntry({
        entry,
        outputDirectory: options.outputDirectory,
        baselinePhase,
        previousPhase,
        root,
        diffDirectory,
      }),
    });
  }
  await writeFile(
    resolve(options.outputDirectory, 'index.html'),
    rendererContactSheetHtml({
      phase: options.phase,
      captures,
      ...(lodAcceptance
        ? { appendix: rendererLodAcceptanceContactSheetAppendix(lodAcceptance) }
        : {}),
    }),
    'utf8',
  );
}
