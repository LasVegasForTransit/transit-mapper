/**
 * Structural checks shared by the Phase 2 evidence manifest sections.
 *
 * These checks intentionally accept `unknown`: capture artifacts are files on
 * disk, so validation must establish their shape before treating them as the
 * strongly typed data the runner produced.
 */
import type { RendererLodAcceptanceCamera } from '../../src/perf/renderer-lod-acceptance';
import type { RendererCaptureManifest } from './capture-types';
import type { RendererLodAcceptanceStatsSnapshot } from './lod-acceptance-types';

export const SHA_256 = /^[a-f0-9]{64}$/;

const STAT_KEYS = [
  'projectionCount',
  'fullUploadCount',
  'sourceUploadCount',
  'editorProjectionCount',
  'editorSourceUploadCount',
] as const satisfies readonly (keyof RendererLodAcceptanceStatsSnapshot)[];

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function exactIdSet(entries: unknown[], expected: readonly string[]): boolean {
  const ids = entries.map((entry) => record(entry)?.id).filter((id): id is string => !!id);
  return (
    ids.length === expected.length &&
    new Set(ids).size === expected.length &&
    expected.every((id) => ids.includes(id))
  );
}

export function validSource(source: unknown): source is RendererCaptureManifest['source'] {
  const candidate = record(source);
  return (
    !!candidate &&
    typeof candidate.revision === 'string' &&
    /^[a-f0-9]{40}$/.test(candidate.revision) &&
    typeof candidate.dirty === 'boolean' &&
    typeof candidate.contentSha256 === 'string' &&
    SHA_256.test(candidate.contentSha256)
  );
}

export function sameSource(
  source: RendererCaptureManifest['source'],
  expected: RendererCaptureManifest['source'],
): boolean {
  return (
    source.revision === expected.revision &&
    source.dirty === expected.dirty &&
    source.contentSha256 === expected.contentSha256
  );
}

export function validStats(value: unknown): value is RendererLodAcceptanceStatsSnapshot {
  const candidate = record(value);
  return (
    !!candidate &&
    STAT_KEYS.every((key) => {
      const count = candidate[key];
      return typeof count === 'number' && Number.isInteger(count) && count >= 0;
    })
  );
}

function validCenter(center: unknown): center is readonly [number, number] {
  return (
    Array.isArray(center) &&
    center.length === 2 &&
    center.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  );
}

function validViewport(value: unknown): value is RendererLodAcceptanceCamera['viewport'] {
  const viewport = record(value);
  return (
    !!viewport &&
    typeof viewport.width === 'number' &&
    Number.isInteger(viewport.width) &&
    viewport.width > 0 &&
    typeof viewport.height === 'number' &&
    Number.isInteger(viewport.height) &&
    viewport.height > 0 &&
    typeof viewport.pixelRatio === 'number' &&
    Number.isFinite(viewport.pixelRatio) &&
    viewport.pixelRatio > 0
  );
}

function matchesExpectedCamera(
  candidate: RendererLodAcceptanceCamera,
  expected: RendererLodAcceptanceCamera,
): boolean {
  return (
    candidate.center[0] === expected.center[0] &&
    candidate.center[1] === expected.center[1] &&
    candidate.zoom === expected.zoom &&
    candidate.viewport.width === expected.viewport.width &&
    candidate.viewport.height === expected.viewport.height &&
    candidate.viewport.pixelRatio === expected.viewport.pixelRatio &&
    candidate.targetCorridorWidthPx === expected.targetCorridorWidthPx
  );
}

export function validCamera(value: unknown, expected?: RendererLodAcceptanceCamera): boolean {
  const candidate = record(value);
  if (
    !candidate ||
    !validCenter(candidate.center) ||
    typeof candidate.zoom !== 'number' ||
    !Number.isFinite(candidate.zoom) ||
    !validViewport(candidate.viewport)
  ) {
    return false;
  }
  return (
    !expected ||
    matchesExpectedCamera(candidate as unknown as RendererLodAcceptanceCamera, expected)
  );
}

export function validMovingCamera(value: unknown, expected: RendererLodAcceptanceCamera): boolean {
  if (!validCamera(value)) return false;
  const candidate = value as RendererLodAcceptanceCamera;
  return (
    candidate.zoom === expected.zoom &&
    candidate.viewport.width === expected.viewport.width &&
    candidate.viewport.height === expected.viewport.height &&
    candidate.viewport.pixelRatio === expected.viewport.pixelRatio &&
    candidate.targetCorridorWidthPx === expected.targetCorridorWidthPx &&
    Math.hypot(
      candidate.center[0] - expected.center[0],
      candidate.center[1] - expected.center[1],
    ) <= 0.02
  );
}

export function validFixture(value: unknown, expectedId?: string): boolean {
  const candidate = record(value);
  return (
    !!candidate &&
    typeof candidate.id === 'string' &&
    (!expectedId || candidate.id === expectedId) &&
    typeof candidate.documentId === 'string' &&
    candidate.documentId.length > 0 &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt)
  );
}

export function computedDelta(
  before: RendererLodAcceptanceStatsSnapshot,
  after: RendererLodAcceptanceStatsSnapshot,
): RendererLodAcceptanceStatsSnapshot {
  return Object.fromEntries(
    STAT_KEYS.map((key) => [key, after[key] - before[key]]),
  ) as unknown as RendererLodAcceptanceStatsSnapshot;
}

export function statsEqual(
  left: RendererLodAcceptanceStatsSnapshot,
  right: RendererLodAcceptanceStatsSnapshot,
): boolean {
  return STAT_KEYS.every((key) => left[key] === right[key]);
}
