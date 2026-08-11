import type {
  RendererLodAcceptanceAssertionId,
  RendererLodAcceptanceCamera,
  RendererLodAcceptanceFixtureId,
  RendererLodAcceptanceSurface,
  RendererLodAcceptanceVisualCase,
} from '../../src/perf/renderer-lod-acceptance';
import type { RendererCaptureManifest } from './capture-types';

/** Counters isolated for Phase 2 acceptance. Committed source uploads are
 * derived from banked MapLibre source IDs; editor uploads are derived from
 * the three unbanked editor-owned source IDs. */
export interface RendererLodAcceptanceStatsSnapshot {
  projectionCount: number;
  fullUploadCount: number;
  sourceUploadCount: number;
  editorProjectionCount: number;
  editorSourceUploadCount: number;
}

export interface RendererLodAcceptanceFixtureProvenance {
  id: RendererLodAcceptanceFixtureId;
  documentId: string;
  updatedAt: number;
}

export interface RendererLodAcceptanceVisualEntry extends RendererLodAcceptanceVisualCase {
  fixture: RendererLodAcceptanceFixtureProvenance;
  camera: RendererLodAcceptanceCamera;
  surface: RendererLodAcceptanceSurface;
  rendererStats: RendererLodAcceptanceStatsSnapshot;
  sha256: string;
}

export type RendererLodAcceptanceStatsDelta = RendererLodAcceptanceStatsSnapshot;

export type RendererLodAcceptanceActionObservation =
  | {
      kind: 'hover-feature-state';
      sourceId: string;
      featureId: string;
      hover: true;
    }
  | {
      kind: 'way-type-filter';
      wayTypeId: 'road';
      beforeChecked: true;
      afterChecked: false;
      beforeFilterSha256: string;
      afterFilterSha256: string;
    }
  | {
      kind: 'map-scheme';
      before: 'light';
      after: 'dark';
      overlayHealthy: true;
    };

export interface RendererLodAcceptanceStatsAssertion {
  id: Exclude<RendererLodAcceptanceAssertionId, 'bank-promotion-is-atomic'>;
  kind: 'renderer-stats';
  action: string;
  fixture: RendererLodAcceptanceFixtureProvenance;
  camera: RendererLodAcceptanceCamera;
  before: RendererLodAcceptanceStatsSnapshot;
  after: RendererLodAcceptanceStatsSnapshot;
  delta: RendererLodAcceptanceStatsDelta;
  observation?: RendererLodAcceptanceActionObservation;
  passed: boolean;
  failure?: string;
}

export interface RendererLodAcceptanceBankIdentity {
  /** Accepted CPU revision exposed by the perf bank snapshot. */
  activeRevision: string;
  /** Physical MapLibre IDs observed independently at the visual, data, hit,
   * and feature-state boundaries. Validation derives the bank suffix from
   * every ID instead of trusting a repeated bank label. */
  visibleLayerIds: string[];
  visibleSourceIds: string[];
  hitSourceId: string;
  hitLayerIds: string[];
  featureStateSourceIds: string[];
}

export interface RendererLodAcceptanceBankAssertion {
  id: 'bank-promotion-is-atomic';
  kind: 'bank-identity';
  action: string;
  fixture: RendererLodAcceptanceFixtureProvenance;
  camera: RendererLodAcceptanceCamera;
  before: RendererLodAcceptanceBankIdentity;
  duringPreparation: RendererLodAcceptanceBankIdentity;
  afterPromotion: RendererLodAcceptanceBankIdentity;
  passed: boolean;
  failure?: string;
}

export type RendererLodAcceptanceAssertion =
  RendererLodAcceptanceStatsAssertion | RendererLodAcceptanceBankAssertion;

export interface RendererLodAcceptanceManifest {
  schemaVersion: 1;
  suiteId: 'phase-2-lod';
  phase: '01-lod';
  generatedAt: string;
  source: RendererCaptureManifest['source'];
  basemap: 'local-blank-v2';
  visuals: RendererLodAcceptanceVisualEntry[];
  assertions: RendererLodAcceptanceAssertion[];
}
