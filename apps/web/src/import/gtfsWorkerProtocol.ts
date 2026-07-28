import type { GtfsImportBatch } from '@transitmapper/core/model/gtfsImport';

export interface GtfsWorkerRequest {
  archive: ArrayBuffer;
  batchSize: number;
}

export type GtfsWorkerPhase = 'inflate-and-index' | 'building-routes';

export interface GtfsWorkerPhaseEvent {
  kind: 'phase';
  phase: GtfsWorkerPhase;
}

export interface GtfsWorkerBatchEvent {
  kind: 'batch';
  batch: GtfsImportBatch;
}

export interface GtfsWorkerDoneEvent {
  kind: 'done';
}

export interface GtfsWorkerErrorEvent {
  kind: 'error';
  message: string;
}

export type GtfsWorkerEvent =
  GtfsWorkerPhaseEvent | GtfsWorkerBatchEvent | GtfsWorkerDoneEvent | GtfsWorkerErrorEvent;
