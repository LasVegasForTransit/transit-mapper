import { describe, expect, it } from 'vitest';
import type { GtfsImportResult } from '../../src/model/gtfsImport';
import {
  appendGtfsImportBatch,
  createGtfsImportDraft,
  gtfsImportServiceIds,
  materializeGtfsImportDraft,
} from '../../src/model/gtfs-import-staging';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

function importedPieces(): GtfsImportResult {
  const way = aRoad('imported-way', [
    [-115.16, 36.14],
    [-115.12, 36.14],
  ]);
  const service = aService('imported-service', [aPattern('imported-pattern', [way], [way.id])]);
  return {
    ways: [way],
    lines: [
      {
        id: 'imported-line',
        name: 'Imported line',
        color: '#123456',
        serviceIds: [service.id],
      },
    ],
    services: [service],
    stops: [],
    stations: [],
  };
}

describe('GTFS import staging', () => {
  it('collects batches without changing the accepted document', () => {
    const baseWay = aRoad('base-way', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const base = aSystem({ ways: [baseWay] });
    const pieces = importedPieces();

    const draft = appendGtfsImportBatch(createGtfsImportDraft(), pieces);
    const candidate = materializeGtfsImportDraft(base, draft);

    expect(base.ways).toEqual([baseWay]);
    expect(base.lines).toEqual([]);
    expect(base.services).toEqual([]);
    expect(candidate.ways.map(({ id }) => id)).toEqual(['base-way', 'imported-way']);
    expect(candidate.lines.map(({ id }) => id)).toEqual(['imported-line']);
    expect(candidate.services.map(({ id }) => id)).toEqual(['imported-service']);
    expect(draft.batches).toHaveLength(1);
    expect(gtfsImportServiceIds(draft)).toEqual(['imported-service']);
  });
});
