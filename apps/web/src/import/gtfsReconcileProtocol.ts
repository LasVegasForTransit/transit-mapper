import type { TransitSystem } from '@transitmapper/core/model/system';

export interface GtfsReconcileRequest {
  system: TransitSystem;
  serviceIds: string[];
}

interface GtfsReconcileSuccess {
  kind: 'done';
  system: TransitSystem;
  reconciled: number;
}

interface GtfsReconcileFailure {
  kind: 'error';
  message: string;
}

export type GtfsReconcileEvent = GtfsReconcileSuccess | GtfsReconcileFailure;
