import { describe, expect, it } from 'vitest';
import { completedImportLabel } from '../../src/import/background-osm-import';

describe('background OpenStreetMap import progress', () => {
  it('reports ways committed after store deduplication instead of raw converted ways', () => {
    expect(
      completedImportLabel(
        {
          type: 'done',
          operationId: 1,
          completedTiles: 2,
          totalTiles: 2,
          convertedWays: 7,
          missedTiles: [],
        },
        4,
      ),
    ).toBe('Imported 4 OpenStreetMap ways');
  });
});
