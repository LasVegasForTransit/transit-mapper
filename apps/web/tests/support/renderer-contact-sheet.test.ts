import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SRC_HIT_FEATURES } from '@transitmapper/renderer/layers';
import { LIGHT_LAYER_SPECS } from '../../src/map/layers';
import { bankedLayerId, bankedSourceId, type SourceBankId } from '@transitmapper/renderer/layers';
import { isBankedRenderLayer } from '@transitmapper/renderer/layers';
import { COMMITTED_SYSTEM_FEATURE_SOURCES } from '@transitmapper/renderer/layers';
import {
  RENDERER_LOD_ACCEPTANCE_STATS_ASSERTION_IDS,
  RENDERER_LOD_ACCEPTANCE_VISUAL_CASES,
} from '../../src/perf/renderer-lod-acceptance';
import type {
  RendererLodAcceptanceActionObservation,
  RendererLodAcceptanceBankIdentity,
  RendererLodAcceptanceManifest,
  RendererLodAcceptanceStatsSnapshot,
} from '../../scripts/renderer-capture/lod-acceptance-types';
import { rendererCaptureDigest } from '../../scripts/renderer-capture/lifecycle';

export const CURRENT_RENDERER_CAPTURE_SOURCE = {
  revision: '0123456789abcdef0123456789abcdef01234567',
  dirty: true,
  contentSha256: 'a'.repeat(64),
} as const;
export const LEGACY_RENDERER_CAPTURE_SOURCE = {
  revision: '0123456789abcdef0123456789abcdef01234567',
  dirty: true,
} as const;

function acceptanceStats(
  overrides: Partial<RendererLodAcceptanceStatsSnapshot> = {},
): RendererLodAcceptanceStatsSnapshot {
  return {
    projectionCount: 10,
    fullUploadCount: 2,
    sourceUploadCount: 20,
    editorProjectionCount: 1,
    editorSourceUploadCount: 3,
    ...overrides,
  };
}

function acceptanceBankIdentity(
  bank: SourceBankId,
  activeRevision: string,
): RendererLodAcceptanceBankIdentity {
  const bankedSpecs = LIGHT_LAYER_SPECS.filter(isBankedRenderLayer);
  return {
    activeRevision,
    visibleLayerIds: bankedSpecs
      .filter((spec) => !('source' in spec) || spec.source !== SRC_HIT_FEATURES)
      .map((spec) => bankedLayerId(spec.id, bank)),
    visibleSourceIds: COMMITTED_SYSTEM_FEATURE_SOURCES.map((sourceId) =>
      bankedSourceId(sourceId, bank),
    ),
    hitSourceId: bankedSourceId(SRC_HIT_FEATURES, bank),
    hitLayerIds: bankedSpecs
      .filter((spec) => 'source' in spec && spec.source === SRC_HIT_FEATURES)
      .map((spec) => bankedLayerId(spec.id, bank)),
    featureStateSourceIds: [bankedSourceId(COMMITTED_SYSTEM_FEATURE_SOURCES[0], bank)],
  };
}

function acceptanceObservation(id: string): RendererLodAcceptanceActionObservation | undefined {
  if (id === 'hover-zero-committed-work') {
    return {
      kind: 'hover-feature-state',
      sourceId: bankedSourceId(COMMITTED_SYSTEM_FEATURE_SOURCES[0], 'a'),
      featureId: 'render:way:port-mason-harbor-bridge',
      hover: true,
    };
  }
  if (id === 'filter-zero-committed-work') {
    return {
      kind: 'way-type-filter',
      wayTypeId: 'road',
      beforeChecked: true,
      afterChecked: false,
      beforeFilterSha256: 'b'.repeat(64),
      afterFilterSha256: 'c'.repeat(64),
    };
  }
  if (id === 'retained-theme-zero-committed-work') {
    return { kind: 'map-scheme', before: 'light', after: 'dark', overlayHealthy: true };
  }
  return undefined;
}

export function rendererLodAcceptanceManifest(): RendererLodAcceptanceManifest {
  const visuals = RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.map((entry) => ({
    ...entry,
    camera: { ...entry.camera, center: [...entry.camera.center] as [number, number] },
    fixture: { id: entry.fixtureId, documentId: `fixture-${entry.fixtureId}`, updatedAt: 0 },
    rendererStats: acceptanceStats(),
    sha256: rendererCaptureDigest(Buffer.from(entry.id)),
  }));
  const before = acceptanceStats();
  const assertions: RendererLodAcceptanceManifest['assertions'] =
    RENDERER_LOD_ACCEPTANCE_STATS_ASSERTION_IDS.map((id) => {
      const after =
        id === 'invalidating-camera-reprojects'
          ? acceptanceStats({ projectionCount: 11 })
          : id === 'selection-zero-committed-work'
            ? acceptanceStats({ editorProjectionCount: 2, editorSourceUploadCount: 4 })
            : acceptanceStats();
      const observation = acceptanceObservation(id);
      return {
        id,
        kind: 'renderer-stats',
        action: id,
        fixture: { id: 'port-mason', documentId: 'renderer-port-mason', updatedAt: 0 },
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
        ...(observation ? { observation } : {}),
        passed: true,
      };
    });
  assertions.push({
    id: 'bank-promotion-is-atomic',
    kind: 'bank-identity',
    action: 'promote a prepared revision',
    fixture: { id: 'port-mason', documentId: 'renderer-port-mason', updatedAt: 0 },
    camera: RENDERER_LOD_ACCEPTANCE_VISUAL_CASES[0].camera,
    before: acceptanceBankIdentity('a', 'old'),
    duringPreparation: acceptanceBankIdentity('a', 'old'),
    afterPromotion: acceptanceBankIdentity('b', 'new'),
    passed: true,
  });
  return {
    schemaVersion: 1,
    suiteId: 'phase-2-lod',
    phase: '01-lod',
    generatedAt: '2026-08-11T19:00:00.000Z',
    source: CURRENT_RENDERER_CAPTURE_SOURCE,
    basemap: 'local-blank-v2',
    visuals,
    assertions,
  };
}

export async function writeRendererLodAcceptance(directory: string): Promise<void> {
  const manifest = rendererLodAcceptanceManifest();
  const acceptanceDirectory = join(directory, 'acceptance');
  await mkdir(join(acceptanceDirectory, 'images'), { recursive: true });
  await Promise.all(
    manifest.visuals.map((entry) =>
      writeFile(join(acceptanceDirectory, entry.file), Buffer.from(entry.id)),
    ),
  );
  await writeFile(join(acceptanceDirectory, 'manifest.json'), JSON.stringify(manifest));
}
