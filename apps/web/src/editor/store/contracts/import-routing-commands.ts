import type { ReconcileImportedSystemResult } from '@transitmapper/core/model/corridor-edits';
import type { ImportedNetwork } from '@transitmapper/core/model/import';
import type { RouteAnchor, RouteSpan } from '@transitmapper/core/model/routeGraph';
import type { Service, Station, TransitSystem, Way } from '@transitmapper/core/model/system';

interface GtfsImportPieces {
  ways: Way[];
  lines: TransitSystem['lines'];
  services: Service[];
  stations: Station[];
}

interface ApplyGtfsImportBatch {
  targetSystemId: string;
  pieces: GtfsImportPieces;
}

interface ApplyImportedNetwork {
  targetSystemId: string;
  network: ImportedNetwork;
}

interface ApplyImportedReconciliation {
  expectedSystem: TransitSystem;
  result: ReconcileImportedSystemResult;
}

export interface ImportCommands {
  readonly importWays: (network: ImportedNetwork) => { added: number; skipped: number };
  readonly applyImportedNetwork: (
    request: ApplyImportedNetwork,
  ) => { added: number; skipped: number } | null;
  readonly importGtfs: (pieces: GtfsImportPieces) => void;
  readonly applyGtfsImportBatch: (request: ApplyGtfsImportBatch) => boolean;
  readonly reconcileImportedServices: (serviceIds: string[]) => number;
  readonly applyImportedReconciliation: (request: ApplyImportedReconciliation) => boolean;
}

export interface RoutingCommands {
  readonly startRouteDraft: (anchor: RouteAnchor) => void;
  readonly extendRouteDraft: (anchor: RouteAnchor) => boolean;
  readonly commitRouteDraft: () => string | null;
  readonly cancelRouteDraft: () => void;
  readonly createRoutedService: (spans: RouteSpan[], modeId?: string) => string | null;
  readonly adoptExistingInfrastructure: (serviceId: string) => number;
  readonly startReturnPathDraft: (serviceId: string, patternId: string) => boolean;
  readonly attachReturnPath: (serviceId: string, patternId: string, spans: RouteSpan[]) => boolean;
}
