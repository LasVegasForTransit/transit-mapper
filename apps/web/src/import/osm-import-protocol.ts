import type { ImportBBox, ImportCategory, ImportedNetwork } from '@transitmapper/core/model/import';
import type { DrivingSide } from '@transitmapper/core/model/system';

export interface OsmImportRequest {
  operationId: number;
  targetSystemId: string;
  bounds: ImportBBox;
  /** Present when retrying missed areas; otherwise bounds is tiled normally. */
  tiles?: ImportBBox[];
  categories: ImportCategory[];
  drivingSide: DrivingSide;
}

interface OsmImportProgressFields {
  operationId: number;
  completedTiles: number;
  totalTiles: number;
  convertedWays: number;
}

interface OsmImportProgressEvent extends OsmImportProgressFields {
  type: 'progress';
}

interface OsmImportBatchEvent extends OsmImportProgressFields {
  type: 'batch';
  network: ImportedNetwork;
}

interface OsmImportTerminalEvent {
  operationId: number;
  completedTiles: number;
  totalTiles: number;
  convertedWays: number;
  missedTiles: ImportBBox[];
}

export type OsmImportEvent =
  | OsmImportProgressEvent
  | OsmImportBatchEvent
  | (OsmImportTerminalEvent & { type: 'done' })
  | (OsmImportTerminalEvent & { type: 'canceled'; message: string })
  | (OsmImportTerminalEvent & { type: 'error'; message: string });

export type OsmImportWorkerMessage =
  { type: 'start'; request: OsmImportRequest } | { type: 'cancel'; operationId: number };
