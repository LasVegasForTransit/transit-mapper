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
import { rendererContactSheetHtml, type RendererContactSheetCapture } from './contact-sheet';
import type { RendererCaptureManifestEntry } from './capture-types';
import { rendererCaptureDigest } from './lifecycle';

const NUMBERED_PHASE = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA_256 = /^[a-f0-9]{64}$/;

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

function hasCompleteManifestHeader(candidate: Record<string, unknown>, phase: string): boolean {
  if (candidate.schemaVersion !== 1) return false;
  if (candidate.phase !== phase) return false;
  if (candidate.complete !== true) return false;
  if (!candidate.selection || typeof candidate.selection !== 'object') return false;
  const selection = candidate.selection as Record<string, unknown>;
  return selection.profile === 'all' && selection.theme === 'all';
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
): Array<{ path: string; sha256: string }> | undefined {
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
  return expected.size === 0 ? files : undefined;
}

async function isSuccessfulPhase(root: string, phase: string): Promise<boolean> {
  if (!NUMBERED_PHASE.test(phase)) return false;
  const phaseDirectory = resolve(root, phase);
  if (await fileExists(resolve(phaseDirectory, 'capture-error.json'))) return false;
  try {
    const manifest = JSON.parse(
      await readFile(resolve(phaseDirectory, 'manifest.json'), 'utf8'),
    ) as unknown;
    const files = completeManifestFiles(manifest, phase, phaseDirectory);
    if (!files) return false;
    const valid = await Promise.all(
      files.map(async (file) => {
        const bytes = await readFile(file.path);
        return rendererCaptureDigest(bytes) === file.sha256;
      }),
    );
    return valid.every(Boolean);
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
    rendererContactSheetHtml({ phase: options.phase, captures }),
    'utf8',
  );
}
