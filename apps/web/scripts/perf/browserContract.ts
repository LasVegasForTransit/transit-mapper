import type { LngLat } from '@transitmapper/core/model/system';
import type { EventTimingSample } from '../../src/perf/eventTiming';
import {
  INDEXED_DB_DOCUMENT_STORE,
  INDEXED_DB_INDEX_STORE,
} from '../../src/storage/indexedDbLibrary';
import type { PerfPhaseCounters, PerfProductionPersistenceProbe } from '../../src/perf/types';
import type { SourceUploadCount, SourceUploadTiming } from '../../src/perf/source-uploads';
import type { RendererStatsSnapshot } from '@transitmapper/renderer/stats';
import type {
  PerfRenderSourceBankSnapshot,
  RendererPerfLayerVisibility,
  RendererPerfRenderedFeature,
} from '../../src/perf';

/**
 * Stable storage identifiers used to seed and inspect the production path.
 * Exported object-store names come from production; remaining private names
 * are centralized here instead of repeated across browser evaluations.
 */
export const PERF_STORAGE_CONTRACT = {
  databaseName: 'transitmapper-documents',
  databaseVersion: 1,
  documentStore: INDEXED_DB_DOCUMENT_STORE,
  libraryStore: INDEXED_DB_INDEX_STORE,
  activeIdKey: 'transitmapper:activeId',
  onboardingSeenKey: 'transitmapper:onboardingSeen',
  indexedDbHistoryKey: 'transitmapper:indexedDbLibrary',
  legacySystemPrefix: 'transitmapper:system:',
  compatibilityProbeKey: 'transitmapper:perf:persistence-probe',
} as const;

export interface BrowserMetricState {
  largestContentfulPaintMs: number;
  cumulativeLayoutShift: number;
  longTaskTotalMs: number;
  firstMapCanvasMs: number | null;
}

export interface BrowserProductionPersistenceCycle {
  serializationStartedAt: number;
  serializationCompletedAt: number | null;
  indexedDbStartedAt: number | null;
  indexedDbCompletedAt: number | null;
}

export interface BrowserProductionPersistenceState {
  cycles: BrowserProductionPersistenceCycle[];
}

export interface GestureCaptureState {
  eventTimings: EventTimingSample[];
  animationFrameMs: number[];
  longTaskMs: number[];
  active: boolean;
  lastFrameAt: number;
  startedAt: number;
  sourceUploadsBefore: number | null;
  sourceUploadTimingsBefore: SourceUploadTiming[] | null;
}

export interface BrowserOverlaySnapshot {
  sourceExists: boolean;
  layerExists: boolean;
  symbolLayerExists: boolean;
  overlayHealthy: boolean;
  rendererLayerCount: number;
  expectedRendererLayerCount: number;
  sourceLoaded: boolean;
  featureCount: number;
}

export interface PerfPageWindow extends Window {
  __TRANSITMAPPER_PERF_RUN__?: boolean;
  __genericPerfGesture?: GestureCaptureState;
  __genericPerfFrame?: FrameRequestCallback;
  __panGestureBench?: (options?: { steps?: number; dx?: number; dy?: number }) => Promise<{
    inputToNextPaintMs: number[];
    paintedFrameMs: number[];
    longTaskMs: number[];
    sourceUploadCount: number | null;
  }>;
  __perfSourceUploadCount?: () => number;
  __perfSourceUploadTimings?: () => readonly SourceUploadTiming[];
  __perfProjectLngLat?: (coord: LngLat) => { x: number; y: number };
  __perfStopSnapshot?: (
    stopId: string,
  ) => { coord: LngLat; revision: number; wayCount: number } | null;
  __perfCameraSnapshot?: () => { center: LngLat; zoom: number };
  __perfOverlaySnapshot?: () => BrowserOverlaySnapshot;
  __perfRenderSourceBankSnapshot?: () => PerfRenderSourceBankSnapshot;
  __perfRenderedFeaturesAt?: (coordinate: LngLat) => readonly RendererPerfRenderedFeature[];
  __perfRendererLayerVisibility?: () => readonly RendererPerfLayerVisibility[];
  __perfStartPaintedFrameCapture?: () => void;
  __perfStopPaintedFrameCapture?: () => number[];
  __perfWebGlContextCount?: number;
  __mapProjectionCounts?: () => PerfPhaseCounters & {
    sourceUploadCount: number;
  };
  __rendererStats?: () => RendererStatsSnapshot;
  __perfProductionPersistence?: BrowserProductionPersistenceState;
  __mapStartupTrace?: () => readonly string[];
}

export interface DirectJourneyMeasurements {
  inputToNextPaintMs: number[];
  animationFrameMs: number[];
  longTaskMs: number[];
  sourceUploadCount: number | null;
  sourceUploads: SourceUploadCount[] | null;
  paintedFrameMs: number[] | null;
  actions: Array<'camera-drag' | 'entity-drag' | 'draw'>;
  productionPersistence: PerfProductionPersistenceProbe | null;
}
