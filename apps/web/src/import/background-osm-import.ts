import type { Dispatch, SetStateAction } from 'react';
import type { ImportBBox, ImportCategory } from '@transitmapper/core/model/import';
import type { DrivingSide } from '@transitmapper/core/model/system';
import type { EditorStore } from '../editor/store';
import type { ImportProgress } from '../ui/UiProvider';
import type { OsmImportEvent } from './osm-import-protocol';
import { startOsmImportWorker } from './start-osm-import-worker';

interface BeginBackgroundOsmImportOptions {
  store: EditorStore;
  setImportProgress: Dispatch<SetStateAction<ImportProgress | null>>;
  targetSystemId: string;
  bounds: ImportBBox;
  tiles?: ImportBBox[];
  categories: ImportCategory[];
  drivingSide: DrivingSide;
  /** Test seam for the browser Worker lifecycle. */
  workerStarter?: typeof startOsmImportWorker;
}

let nextOperationId = 10_000;

type TerminalImportEvent = Exclude<OsmImportEvent, { type: 'batch' | 'progress' }>;

export function completedImportLabel(event: TerminalImportEvent, committedWays: number): string {
  if (event.type !== 'done') return `${event.message} Completed batches remain in this system.`;
  if (event.missedTiles.length > 0) {
    return `Imported ${committedWays.toLocaleString()} ways; ${event.missedTiles.length} areas unfinished`;
  }
  return `Imported ${committedWays.toLocaleString()} OpenStreetMap ways`;
}

/** Own one background metro import from Worker start through retry/dismiss. */
export function beginBackgroundOsmImport(options: BeginBackgroundOsmImportOptions): void {
  if (options.store.getState().system.id !== options.targetSystemId) return;
  const operationId = ++nextOperationId;
  let committedWays = 0;
  let cancelWorker = () => {};
  let ownerChanged = false;
  const dismiss = () =>
    options.setImportProgress((current) => (current?.operationId === operationId ? null : current));
  const cancel = () => cancelWorker();
  const loading = (done: number, total: number, label = 'Importing OpenStreetMap') =>
    options.setImportProgress({
      operationId,
      label,
      done,
      total,
      unit: 'tiles',
      state: 'loading',
      cancel,
    });
  loading(0, options.tiles?.length ?? 0, 'Preparing OpenStreetMap tiles…');
  const finish = (event: TerminalImportEvent) => {
    const partial = event.missedTiles.length > 0;
    const retry =
      partial && !ownerChanged
        ? () => beginBackgroundOsmImport({ ...options, tiles: event.missedTiles })
        : undefined;
    let state: ImportProgress['state'] = event.type;
    if (event.type === 'done') state = partial ? 'error' : 'done';
    options.setImportProgress({
      operationId,
      label: completedImportLabel(event, committedWays),
      done: event.completedTiles,
      total: event.totalTiles,
      unit: 'tiles',
      state,
      dismiss,
      ...(retry ? { retry } : {}),
    });
  };

  const running = (options.workerStarter ?? startOsmImportWorker)(
    {
      operationId,
      targetSystemId: options.targetSystemId,
      bounds: options.bounds,
      ...(options.tiles ? { tiles: options.tiles } : {}),
      categories: options.categories,
      drivingSide: options.drivingSide,
    },
    {
      onEvent: (event) => {
        if (event.type === 'batch') {
          const result = options.store.getState().applyOsmImportBatch({
            targetSystemId: options.targetSystemId,
            network: event.network,
          });
          committedWays += result.added;
          if (!result.applied) {
            ownerChanged = true;
            cancelWorker();
          }
          return;
        }
        if (event.type === 'progress') {
          loading(event.completedTiles, event.totalTiles);
          return;
        }

        finish(event);
      },
    },
  );
  cancelWorker = running.cancel;
  const unsubscribe = options.store.subscribe((state) => {
    if (state.system.id !== options.targetSystemId && !ownerChanged) {
      ownerChanged = true;
      cancelWorker();
    }
  });
  void running.completion.finally(unsubscribe);
}
