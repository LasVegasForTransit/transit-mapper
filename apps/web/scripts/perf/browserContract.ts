import type { LngLat } from '@transitmapper/core/model/system';
import type { EventTimingSample } from '../../src/perf/eventTiming';
import {
  INDEXED_DB_DOCUMENT_STORE,
  INDEXED_DB_INDEX_STORE,
} from '../../src/storage/indexedDbLibrary';
import type { PerfPhaseCounters, PerfProductionPersistenceProbe } from '../../src/perf/types';

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
  serializerWorkerName: 'transitmapper-storage-serializer',
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
  workerStartedAt: number;
  workerCompletedAt: number | null;
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
}

export interface BrowserOverlaySnapshot {
  sourceExists: boolean;
  layerExists: boolean;
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
  __perfProjectLngLat?: (coord: LngLat) => { x: number; y: number };
  __perfStationSnapshot?: (
    stationId: string,
  ) => { coord: LngLat; revision: number; wayCount: number } | null;
  __perfCameraSnapshot?: () => { center: LngLat; zoom: number };
  __perfOverlaySnapshot?: () => BrowserOverlaySnapshot;
  __perfStartPaintedFrameCapture?: () => void;
  __perfStopPaintedFrameCapture?: () => number[];
  __perfWebGlContextCount?: number;
  __mapProjectionCounts?: () => PerfPhaseCounters & {
    sourceUploadCount: number;
  };
  __perfProductionPersistence?: BrowserProductionPersistenceState;
}

export interface DirectJourneyMeasurements {
  inputToNextPaintMs: number[];
  animationFrameMs: number[];
  longTaskMs: number[];
  sourceUploadCount: number | null;
  paintedFrameMs: number[] | null;
  actions: Array<'camera-drag' | 'entity-drag' | 'draw'>;
  productionPersistence: PerfProductionPersistenceProbe | null;
}
