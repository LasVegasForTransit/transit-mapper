import type { GtfsImportBatch } from '@transitmapper/core/model/gtfsImport';

export interface GtfsWorkerRequest {
  archive: ArrayBuffer;
  batchSize: number;
}

export type GtfsWorkerPhase = 'inflate-and-index' | 'building-routes';

interface GtfsWorkerPhaseEvent {
  kind: 'phase';
  phase: GtfsWorkerPhase;
}

interface GtfsWorkerBatchEvent {
  kind: 'batch';
  batch: GtfsImportBatch;
}

interface GtfsWorkerDoneEvent {
  kind: 'done';
}

interface GtfsWorkerErrorEvent {
  kind: 'error';
  message: string;
}

export type GtfsWorkerEvent =
  GtfsWorkerPhaseEvent | GtfsWorkerBatchEvent | GtfsWorkerDoneEvent | GtfsWorkerErrorEvent;
