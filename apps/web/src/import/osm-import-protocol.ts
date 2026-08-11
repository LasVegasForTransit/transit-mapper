import type { ImportBBox, ImportCategory, ImportedNetwork } from '@transitmapper/core/model/import';
import type { DrivingSide } from '@transitmapper/core/model/system';

export interface OsmImportRequest {
  bbox: ImportBBox;
  categories: ImportCategory[];
  drivingSide: DrivingSide;
}

interface OsmImportSuccess {
  kind: 'done';
  network: ImportedNetwork;
}

interface OsmImportFailure {
  kind: 'error';
  error: {
    name: string;
    message: string;
  };
}

export type OsmImportEvent = OsmImportSuccess | OsmImportFailure;
