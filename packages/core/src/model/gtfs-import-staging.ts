import { formCrossingJunctions } from './crossing-edits';
import type { GtfsImportResult } from './gtfsImport';
import type { TransitSystem } from './system';

export interface GtfsImportDraft {
  readonly batches: readonly GtfsImportResult[];
}

/** Holds parsed GTFS output outside a live editor document until every route
 * has been reconciled onto the candidate's physical network. */
export function createGtfsImportDraft(): GtfsImportDraft {
  return { batches: [] };
}

export function appendGtfsImportBatch(
  draft: GtfsImportDraft,
  pieces: GtfsImportResult,
): GtfsImportDraft {
  return {
    // A batch reference costs one slot. Re-copying all completed route data
    // after every streamed route would make large imports quadratic on the UI thread.
    batches: [...draft.batches, pieces],
  };
}

export function gtfsImportServiceIds(draft: GtfsImportDraft): string[] {
  return draft.batches.flatMap(({ services }) => services.map(({ id }) => id));
}

/** Builds one uncommitted candidate. Callers must reconcile it before they
 * publish it through the editor command that checks the base identity. */
export function materializeGtfsImportDraft(
  system: TransitSystem,
  draft: GtfsImportDraft,
): TransitSystem {
  const pieces: GtfsImportResult = {
    ways: draft.batches.flatMap(({ ways }) => ways),
    lines: draft.batches.flatMap(({ lines }) => lines),
    services: draft.batches.flatMap(({ services }) => services),
    stops: draft.batches.flatMap(({ stops }) => stops),
    stations: draft.batches.flatMap(({ stations }) => stations),
  };
  const candidate: TransitSystem = {
    ...system,
    ways: [...system.ways, ...pieces.ways],
    lines: [...system.lines, ...pieces.lines],
    services: [...system.services, ...pieces.services],
    stops: [...system.stops, ...pieces.stops],
    stations: [...system.stations, ...pieces.stations],
  };
  return pieces.ways.reduce((current, way) => formCrossingJunctions(current, way.id), candidate);
}
