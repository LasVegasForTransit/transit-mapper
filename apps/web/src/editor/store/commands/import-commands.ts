import { withComponent } from '@transitmapper/core/model/components';
import { reconcileImportedSystem } from '@transitmapper/core/model/corridor-edits';
import { formCrossingJunctions } from '@transitmapper/core/model/crossing-edits';
import { withoutAlreadyImported, type ImportedNetwork } from '@transitmapper/core/model/import';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { ImportCommands } from '../contracts/import-routing-commands';
import type { EditorRuntime } from '../runtime';

function withCrossings(system: TransitSystem, wayIds: string[]): TransitSystem {
  return wayIds.reduce((current, wayId) => formCrossingJunctions(current, wayId), system);
}

interface ImportWaysResult {
  system: TransitSystem;
  added: number;
  skipped: number;
}

function importedWaysResult(system: TransitSystem, incoming: ImportedNetwork): ImportWaysResult {
  const { network, duplicateWays, identityAdditions, junctionAdditions } = withoutAlreadyImported(
    incoming,
    system.ways,
    system.namedWays,
    system.nodes,
  );
  const { ways, nodes, namedWays, medians, turnRestrictions } = network;
  const additionsById = new Map(
    identityAdditions.map((addition) => [addition.id, addition.wayIds]),
  );
  const armsById = new Map(junctionAdditions.map((addition) => [addition.id, addition.refs]));
  if (
    ways.length === 0 &&
    nodes.length === 0 &&
    namedWays.length === 0 &&
    additionsById.size === 0 &&
    armsById.size === 0
  ) {
    return { system, added: 0, skipped: duplicateWays };
  }
  const imported: TransitSystem = {
    ...system,
    ways: [...system.ways, ...ways],
    nodes: [
      ...system.nodes.map((node) => {
        const arms = armsById.get(node.id);
        return arms ? { ...node, refs: [...node.refs, ...arms] } : node;
      }),
      ...nodes,
    ],
    namedWays: [
      ...system.namedWays.map((namedWay) => {
        const additions = additionsById.get(namedWay.id);
        return additions ? { ...namedWay, wayIds: [...namedWay.wayIds, ...additions] } : namedWay;
      }),
      ...namedWays,
    ],
    medians: medians.reduce(
      (components, median) => withComponent(components, median.id, median.median),
      system.medians,
    ),
    turnRestrictions: turnRestrictions.reduce(
      (components, restriction) =>
        withComponent(components, restriction.key, restriction.restriction),
      system.turnRestrictions,
    ),
  };
  return {
    system: withCrossings(
      imported,
      ways.map((way) => way.id),
    ),
    added: ways.length,
    skipped: duplicateWays,
  };
}

type GtfsPieces = Parameters<ImportCommands['importGtfs']>[0];

function withGtfsPieces(system: TransitSystem, pieces: GtfsPieces): TransitSystem {
  const imported = {
    ...system,
    ways: [...system.ways, ...pieces.ways],
    lines: [...system.lines, ...pieces.lines],
    services: [...system.services, ...pieces.services],
    stops: [...system.stops, ...pieces.stops],
    stations: [...system.stations, ...(pieces.stations ?? [])],
  };
  return withCrossings(
    imported,
    pieces.ways.map((way) => way.id),
  );
}

function hasGtfsPieces(pieces: GtfsPieces): boolean {
  return (
    pieces.ways.length > 0 ||
    pieces.lines.length > 0 ||
    pieces.services.length > 0 ||
    pieces.stops.length > 0 ||
    (pieces.stations?.length ?? 0) > 0
  );
}

export function createImportCommands(runtime: EditorRuntime): ImportCommands {
  return {
    importWays(incoming) {
      return runtime.commitContent({ added: 0, skipped: 0 }, (state) => {
        const imported = importedWaysResult(state.system, incoming);
        return {
          system: imported.system,
          result: { added: imported.added, skipped: imported.skipped },
        };
      });
    },

    applyImportedNetwork({ targetSystemId, network }) {
      return runtime.commitContent<{ added: number; skipped: number } | null>(null, (state) => {
        if (state.system.id !== targetSystemId) {
          return { system: state.system, result: null };
        }
        const imported = importedWaysResult(state.system, network);
        return {
          system: imported.system,
          result: { added: imported.added, skipped: imported.skipped },
        };
      });
    },

    importGtfs(pieces) {
      runtime.commitContent(undefined, (state) => {
        if (!hasGtfsPieces(pieces)) {
          return { system: state.system, result: undefined };
        }
        return {
          system: withGtfsPieces(state.system, pieces),
          result: undefined,
        };
      });
    },

    applyGtfsImportBatch({ targetSystemId, pieces }) {
      return runtime.commitContent(false, (state) => {
        if (state.system.id !== targetSystemId) {
          return { system: state.system, result: false };
        }
        if (!hasGtfsPieces(pieces)) {
          return { system: state.system, result: true };
        }
        return {
          system: withGtfsPieces(state.system, pieces),
          result: true,
        };
      });
    },

    reconcileImportedServices(serviceIds) {
      return runtime.commitContent(0, (state) => {
        const result = reconcileImportedSystem(state.system, serviceIds);
        return { system: result.system, result: result.reconciled };
      });
    },

    applyImportedReconciliation({ expectedSystem, result }) {
      return runtime.commitContent(false, (state) => {
        const accepted = state.system === expectedSystem;
        return {
          system: accepted && result.reconciled > 0 ? result.system : state.system,
          result: accepted,
        };
      });
    },
  };
}
