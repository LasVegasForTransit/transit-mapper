import type { TransitSystem } from '@transitmapper/core/model/system';
import type { EditorState } from './state';
import { pruneTransientReferences } from './transient-references';

const HISTORY_LIMIT = 100;

interface HistoryHost {
  readonly read: () => EditorState;
  readonly write: (patch: Partial<EditorState>) => void;
}

export interface HistoryController {
  readonly record: (
    previous: TransitSystem,
    next: TransitSystem,
  ) => Pick<EditorState, 'canUndo' | 'canRedo'>;
  readonly reset: () => Pick<EditorState, 'canUndo' | 'canRedo'>;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly beginCheckpoint: () => void;
  readonly commitCheckpoint: () => void;
  readonly cancelCheckpoint: () => void;
}

export type HistoryCommandsPort = Pick<
  HistoryController,
  'undo' | 'redo' | 'beginCheckpoint' | 'commitCheckpoint' | 'cancelCheckpoint'
>;

type HistoryAvailability = Pick<EditorState, 'canUndo' | 'canRedo'>;

function restoreUndoRedoSnapshot(
  host: HistoryHost,
  system: TransitSystem,
  availability: HistoryAvailability,
): void {
  const current = host.read();
  const activeWayId = current.activeWayId;
  const wayStillExists = activeWayId !== null && system.ways.some((way) => way.id === activeWayId);
  const restoredSystem =
    system.viewport !== current.system.viewport
      ? { ...system, viewport: current.system.viewport }
      : system;
  const patch = {
    system: restoredSystem,
    selection: null,
    armedTerminus: null,
    multiSelection: [],
    activeWayId: wayStillExists ? activeWayId : null,
    ...availability,
  } satisfies Partial<EditorState>;
  const candidate = { ...current, ...patch };
  host.write({ ...patch, ...pruneTransientReferences(candidate, restoredSystem) });
}

/** One per editor store. System snapshots stay outside reactive Zustand data. */
export function createHistoryController(host: HistoryHost): HistoryController {
  let past: TransitSystem[] = [];
  let future: TransitSystem[] = [];
  let checkpointBefore: EditorState | null = null;
  let checkpointDepth = 0;
  let checkpointChanged = false;

  const availability = (): HistoryAvailability => ({
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  });

  const appendPast = (system: TransitSystem): void => {
    past.push(system);
    if (past.length > HISTORY_LIMIT) past.shift();
  };

  return {
    record(previous, next) {
      if (next === previous) return availability();
      if (checkpointBefore !== null) {
        checkpointChanged = true;
        return availability();
      }
      appendPast(previous);
      future = [];
      return availability();
    },

    reset() {
      past = [];
      future = [];
      checkpointBefore = null;
      checkpointDepth = 0;
      checkpointChanged = false;
      return availability();
    },

    undo() {
      if (checkpointDepth > 0) return;
      const previous = past.pop();
      if (!previous) return;
      future.push(host.read().system);
      restoreUndoRedoSnapshot(host, previous, availability());
    },

    redo() {
      if (checkpointDepth > 0) return;
      const next = future.pop();
      if (!next) return;
      appendPast(host.read().system);
      restoreUndoRedoSnapshot(host, next, availability());
    },

    beginCheckpoint() {
      checkpointDepth++;
      if (checkpointDepth === 1) {
        checkpointBefore = host.read();
        checkpointChanged = false;
      }
    },

    commitCheckpoint() {
      if (checkpointDepth === 0) return;
      checkpointDepth--;
      if (checkpointDepth > 0) return;
      const before = checkpointBefore;
      checkpointBefore = null;
      const changed = checkpointChanged;
      checkpointChanged = false;
      if (!changed || !before || before.system === host.read().system) return;
      appendPast(before.system);
      future = [];
      host.write(availability());
    },

    cancelCheckpoint() {
      if (checkpointDepth === 0) return;
      const before = checkpointBefore;
      checkpointBefore = null;
      checkpointDepth = 0;
      const changed = checkpointChanged;
      checkpointChanged = false;
      if (!changed || !before || before.system === host.read().system) return;
      host.write(before);
    },
  };
}
