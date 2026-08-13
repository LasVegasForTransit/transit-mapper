import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { describe, expect, it, vi } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import {
  beginBackgroundOsmImport,
  completedImportLabel,
} from '../../src/import/background-osm-import';
import type { OsmImportEvent } from '../../src/import/osm-import-protocol';
import type { ImportProgress } from '../../src/ui/UiProvider';

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

  it('does not offer retry after opening another system cancels the import', async () => {
    const store = createEditorStore();
    const target = createEmptySystem();
    const other = createEmptySystem();
    store.commands.document.setSystem(target);
    const progressUpdates: ImportProgress[] = [];
    let onEvent: ((event: OsmImportEvent) => void) | undefined;
    let resolveCompletion: ((event: OsmImportEvent) => void) | undefined;
    const completion = new Promise<OsmImportEvent>((resolve) => {
      resolveCompletion = resolve;
    });
    const cancel = vi.fn();

    beginBackgroundOsmImport({
      store,
      setImportProgress: (next) => {
        const current = progressUpdates.at(-1) ?? null;
        const updated = typeof next === 'function' ? next(current) : next;
        if (updated) progressUpdates.push(updated);
      },
      targetSystemId: target.id,
      bounds: { west: -115.2, south: 36, east: -115.1, north: 36.1 },
      categories: ['road', 'bike'],
      drivingSide: 'right',
      workerStarter: (_request, options) => {
        onEvent = options.onEvent;
        return { cancel, completion };
      },
    });

    store.commands.document.setSystem(other);
    expect(cancel).toHaveBeenCalledOnce();
    const terminal: OsmImportEvent = {
      type: 'canceled',
      operationId: 10_001,
      completedTiles: 1,
      totalTiles: 2,
      convertedWays: 1,
      missedTiles: [{ west: -115.15, south: 36, east: -115.1, north: 36.1 }],
      message: 'OpenStreetMap import canceled.',
    };
    onEvent?.(terminal);
    resolveCompletion?.(terminal);
    await completion;

    expect(progressUpdates.at(-1)?.state).toBe('canceled');
    expect(progressUpdates.at(-1)?.retry).toBeUndefined();
  });
});
