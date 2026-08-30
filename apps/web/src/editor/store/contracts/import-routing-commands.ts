import type { ReconcileImportedSystemResult } from '@transitmapper/core/model/corridor-edits';
import type { ImportedNetwork } from '@transitmapper/core/model/import';
import type { RouteAnchor, RouteSpan } from '@transitmapper/core/model/routeGraph';
import type { TransitSystem } from '@transitmapper/core/model/system';

interface ApplyCompletedGtfsImport {
  targetSystemId: string;
  expectedSystem: TransitSystem;
  result: ReconcileImportedSystemResult;
}

interface ApplyImportedNetwork {
  targetSystemId: string;
  network: ImportedNetwork;
}

export interface ImportCommands {
  readonly importWays: (network: ImportedNetwork) => { added: number; skipped: number };
  readonly applyImportedNetwork: (
    request: ApplyImportedNetwork,
  ) => { added: number; skipped: number } | null;
  readonly applyCompletedGtfsImport: (request: ApplyCompletedGtfsImport) => boolean;
  readonly reconcileImportedServices: (serviceIds: string[]) => number;
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
