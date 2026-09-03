import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SRC_HIT_FEATURES } from '@transitmapper/map/layers';
import { LIGHT_LAYER_SPECS } from '../../src/map/layers/layerSpecs';
import { isBankedRenderLayer } from '@transitmapper/map/layers';
import { COMMITTED_SYSTEM_FEATURE_SOURCES } from '@transitmapper/map/layers';
import {
  RENDERER_LOD_ACCEPTANCE_STATS_ASSERTION_IDS,
  RENDERER_LOD_ACCEPTANCE_VISUAL_CASES,
} from '../../src/perf/renderer-lod-acceptance';
import type {
  RendererLodAcceptanceManifest,
  RendererLodAcceptanceStatsSnapshot,
} from '../../scripts/renderer-capture/lod-acceptance-types';
import { rendererCaptureDigest } from '../../scripts/renderer-capture/lifecycle';

/** Shared valid corpus for acceptance-validator tests. The individual test
 * files mutate this complete fixture to express exactly one failed invariant. */
export const RENDERER_LOD_ACCEPTANCE_SOURCE = {
  revision: '0123456789abcdef0123456789abcdef01234567',
  dirty: true,
  contentSha256: 'a'.repeat(64),
} as const;

function stats(overrides: Partial<RendererLodAcceptanceStatsSnapshot> = {}) {
  return {
    projectionCount: 10,
    fullUploadCount: 2,
    sourceUploadCount: 20,
    editorProjectionCount: 1,
    editorSourceUploadCount: 3,
    ...overrides,
  };
}

function statAssertion(
  id: (typeof RENDERER_LOD_ACCEPTANCE_STATS_ASSERTION_IDS)[number],
  invalidating = false,
) {
  const before = stats();
  const after = invalidating
    ? stats({ projectionCount: 11 })
    : id === 'selection-zero-committed-work'
      ? stats({ editorProjectionCount: 2, editorSourceUploadCount: 5 })
      : stats();
  return {
    id,
    kind: 'renderer-stats' as const,
    action: id,
    fixture: { id: 'port-mason' as const, documentId: 'renderer-port-mason', updatedAt: 0 },
    camera: RENDERER_LOD_ACCEPTANCE_VISUAL_CASES[0].camera,
    before,
    after,
    delta: {
      projectionCount: after.projectionCount - before.projectionCount,
      fullUploadCount: after.fullUploadCount - before.fullUploadCount,
      sourceUploadCount: after.sourceUploadCount - before.sourceUploadCount,
      editorProjectionCount: after.editorProjectionCount - before.editorProjectionCount,
      editorSourceUploadCount: after.editorSourceUploadCount - before.editorSourceUploadCount,
    },
    ...(id === 'hover-zero-committed-work'
      ? {
          observation: {
            kind: 'hover-feature-state' as const,
            sourceId: 'tm-ways--bank-a',
            featureId: 'way:port-mason-harbor-bridge',
            hover: true as const,
          },
        }
      : id === 'filter-zero-committed-work'
        ? {
            observation: {
              kind: 'way-type-filter' as const,
              wayTypeId: 'road' as const,
              beforeChecked: true as const,
              afterChecked: false as const,
              beforeFilterSha256: 'b'.repeat(64),
              afterFilterSha256: 'c'.repeat(64),
            },
          }
        : id === 'retained-theme-zero-committed-work'
          ? {
              observation: {
                kind: 'map-scheme' as const,
                before: 'light' as const,
                after: 'dark' as const,
                overlayHealthy: true as const,
              },
            }
          : {}),
    passed: true,
  };
}

function layerSource(spec: (typeof LIGHT_LAYER_SPECS)[number]): string | null {
  return 'source' in spec && typeof spec.source === 'string' ? spec.source : null;
}

const BANKED_LAYER_SPECS = LIGHT_LAYER_SPECS.filter(isBankedRenderLayer);
const VISUAL_LAYER_IDS = BANKED_LAYER_SPECS.filter(
  (spec) => layerSource(spec) !== SRC_HIT_FEATURES,
).map((spec) => spec.id);
const HIT_LAYER_IDS = BANKED_LAYER_SPECS.filter(
  (spec) => layerSource(spec) === SRC_HIT_FEATURES,
).map((spec) => spec.id);

export function rendererLodAcceptanceBankIdentity(bank: 'a' | 'b', revision: string) {
  const physical = (id: string) => `${id}--bank-${bank}`;
  return {
    activeRevision: revision,
    visibleLayerIds: VISUAL_LAYER_IDS.map(physical),
    visibleSourceIds: COMMITTED_SYSTEM_FEATURE_SOURCES.map(physical),
    hitSourceId: physical(SRC_HIT_FEATURES),
    hitLayerIds: HIT_LAYER_IDS.map(physical),
    featureStateSourceIds: [physical('tm-ways')],
  };
}

export function validRendererLodAcceptanceManifest(): RendererLodAcceptanceManifest {
  const visuals = RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.map((entry) => ({
    ...entry,
    camera: { ...entry.camera, center: [...entry.camera.center] as [number, number] },
    fixture: { id: entry.fixtureId, documentId: `fixture-${entry.fixtureId}`, updatedAt: 0 },
    rendererStats: stats(),
    sha256: rendererCaptureDigest(Buffer.from(entry.id)),
  }));
  const statsAssertions = RENDERER_LOD_ACCEPTANCE_STATS_ASSERTION_IDS.map((id) =>
    statAssertion(id, id === 'invalidating-camera-reprojects'),
  );
  return {
    schemaVersion: 1,
    suiteId: 'phase-2-lod',
    phase: '01-lod',
    generatedAt: '2026-08-11T19:00:00.000Z',
    source: RENDERER_LOD_ACCEPTANCE_SOURCE,
    basemap: 'local-blank-v2',
    visuals,
    assertions: [
      ...statsAssertions,
      {
        id: 'bank-promotion-is-atomic',
        kind: 'bank-identity',
        action: 'promote a prepared revision',
        fixture: { id: 'port-mason', documentId: 'renderer-port-mason', updatedAt: 0 },
        camera: RENDERER_LOD_ACCEPTANCE_VISUAL_CASES[0].camera,
        before: rendererLodAcceptanceBankIdentity('a', 'revision-old'),
        duringPreparation: rendererLodAcceptanceBankIdentity('a', 'revision-old'),
        afterPromotion: rendererLodAcceptanceBankIdentity('b', 'revision-new'),
        passed: true,
      },
    ],
  };
}

export async function writeRendererLodAcceptanceManifest(
  directory: string,
  manifest: RendererLodAcceptanceManifest,
): Promise<void> {
  await mkdir(join(directory, 'images'), { recursive: true });
  await Promise.all(
    manifest.visuals.map((entry) => writeFile(join(directory, entry.file), entry.id)),
  );
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
}
