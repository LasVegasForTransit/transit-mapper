import { SRC_HIT_FEATURES } from '../../src/map/layers';
import {
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  EDITOR_SYSTEM_FEATURE_SOURCES,
} from '../../src/map/system-feature-sources';
import type {
  RendererLodAcceptanceAssertion,
  RendererLodAcceptanceBankIdentity,
  RendererLodAcceptanceStatsAssertion,
  RendererLodAcceptanceStatsSnapshot,
} from './lod-acceptance-types';

/** Raw counters exposed by the performance seam. They deliberately exclude
 * presentation and MapLibre timing: the acceptance appendix uses them only to
 * distinguish committed rendering work from editor-owned transient work. */
export interface RendererStatsCounters {
  projectionCount: number;
  fullUploadCount: number;
  editorProjectionCount: number;
}

export interface SourceUploadCounter {
  sourceId: string;
  method: 'setData' | 'updateData';
  callCount: number;
}

const COMMITTED_LOGICAL_SOURCE_IDS = new Set<string>([
  ...COMMITTED_SYSTEM_FEATURE_SOURCES,
  SRC_HIT_FEATURES,
]);
const EDITOR_SOURCE_IDS = new Set<string>(EDITOR_SYSTEM_FEATURE_SOURCES);

function logicalBankedSourceId(sourceId: string): string | undefined {
  const match = /^(.*)--bank-[ab]$/.exec(sourceId);
  return match?.[1];
}

/** Converts raw instrumentation into the ownership-specific counters asserted
 * by the acceptance appendix. Vehicle and gesture uploads are neither
 * committed scene work nor editor-source work, so they are intentionally out
 * of both totals. */
export function rendererLodAcceptanceStatsSnapshot(
  renderer: RendererStatsCounters,
  sourceUploads: readonly SourceUploadCounter[],
): RendererLodAcceptanceStatsSnapshot {
  let sourceUploadCount = 0;
  let editorSourceUploadCount = 0;
  for (const upload of sourceUploads) {
    const logicalId = logicalBankedSourceId(upload.sourceId);
    if (logicalId && COMMITTED_LOGICAL_SOURCE_IDS.has(logicalId)) {
      sourceUploadCount += upload.callCount;
    } else if (EDITOR_SOURCE_IDS.has(upload.sourceId)) {
      editorSourceUploadCount += upload.callCount;
    }
  }
  return {
    projectionCount: renderer.projectionCount,
    fullUploadCount: renderer.fullUploadCount,
    sourceUploadCount,
    editorProjectionCount: renderer.editorProjectionCount,
    editorSourceUploadCount,
  };
}

export interface CreateRendererLodAcceptanceStatsAssertionOptions {
  id: RendererLodAcceptanceStatsAssertion['id'];
  action: string;
  fixture: RendererLodAcceptanceStatsAssertion['fixture'];
  camera: RendererLodAcceptanceStatsAssertion['camera'];
  before: RendererLodAcceptanceStatsSnapshot;
  after: RendererLodAcceptanceStatsSnapshot;
  observation?: RendererLodAcceptanceStatsAssertion['observation'];
}

export function rendererLodAcceptanceStatsAssertion({
  id,
  action,
  fixture,
  camera,
  before,
  after,
  observation,
}: CreateRendererLodAcceptanceStatsAssertionOptions): RendererLodAcceptanceStatsAssertion {
  const delta: RendererLodAcceptanceStatsSnapshot = {
    projectionCount: after.projectionCount - before.projectionCount,
    fullUploadCount: after.fullUploadCount - before.fullUploadCount,
    sourceUploadCount: after.sourceUploadCount - before.sourceUploadCount,
    editorProjectionCount: after.editorProjectionCount - before.editorProjectionCount,
    editorSourceUploadCount: after.editorSourceUploadCount - before.editorSourceUploadCount,
  };
  const nonNegative = Object.values(delta).every((value) => value >= 0);
  const passed =
    nonNegative &&
    (id === 'invalidating-camera-reprojects'
      ? delta.projectionCount > 0
      : delta.projectionCount === 0 &&
        delta.fullUploadCount === 0 &&
        delta.sourceUploadCount === 0);
  return {
    id,
    kind: 'renderer-stats',
    action,
    fixture,
    camera,
    before,
    after,
    delta,
    ...(observation ? { observation } : {}),
    passed,
    ...(passed ? {} : { failure: 'Observed renderer-stat deltas violate the acceptance rule.' }),
  };
}

export interface RendererLodAcceptancePerfBankSnapshot {
  activeBank: 'a' | 'b' | null;
  stagingBank: 'a' | 'b' | null;
  activeRevision: string | null;
  activeVisualSourceIds: readonly string[];
  activeVisualLayerIds: readonly string[];
  activeVisualSourceId: string | null;
  activeHitSourceId: string | null;
  activeHitLayerIds: readonly string[];
  activeVisualLayerId: string | null;
  activeHitLayerId: string | null;
  selectedFeatureStateSourceIds: readonly string[];
  diagnostics: unknown;
}

export interface RendererLodAcceptanceBankHost {
  __perfRenderSourceBankSnapshot?: () => RendererLodAcceptancePerfBankSnapshot;
}

export function requiredRendererBankAcceptanceSnapshot(
  host: RendererLodAcceptanceBankHost,
): () => RendererLodAcceptancePerfBankSnapshot {
  if (!host.__perfRenderSourceBankSnapshot) {
    throw new Error('Phase 2 bank acceptance requires __perfRenderSourceBankSnapshot.');
  }
  return host.__perfRenderSourceBankSnapshot;
}

/** Reads the physical identities independently. The validator derives and
 * cross-checks suffixes itself; this adapter never manufactures several pieces
 * of evidence from one bank label. */
export function rendererLodAcceptanceBankIdentity(
  snapshot: RendererLodAcceptancePerfBankSnapshot,
): RendererLodAcceptanceBankIdentity {
  if (
    !snapshot.activeRevision ||
    snapshot.activeVisualLayerIds.length === 0 ||
    snapshot.activeVisualSourceIds.length === 0 ||
    !snapshot.activeHitSourceId ||
    snapshot.activeHitLayerIds.length === 0 ||
    snapshot.selectedFeatureStateSourceIds.length === 0
  ) {
    throw new Error('Renderer bank snapshot is missing active identity evidence.');
  }
  return {
    activeRevision: snapshot.activeRevision,
    visibleLayerIds: [...snapshot.activeVisualLayerIds],
    visibleSourceIds: [...snapshot.activeVisualSourceIds],
    hitSourceId: snapshot.activeHitSourceId,
    hitLayerIds: [...snapshot.activeHitLayerIds],
    featureStateSourceIds: [...snapshot.selectedFeatureStateSourceIds],
  };
}

export type RendererLodAcceptanceBankAssertion = Extract<
  RendererLodAcceptanceAssertion,
  { kind: 'bank-identity' }
>;
