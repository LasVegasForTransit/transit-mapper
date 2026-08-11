import type { TransitSystem } from '@transitmapper/core/model/system';
import type { EditorState } from './state';

const HISTORY_LIMIT = 100;

type HistoryPatch = Pick<
  EditorState,
  | 'system'
  | 'selection'
  | 'armedTerminus'
  | 'multiSelection'
  | 'activeWayId'
  | 'canUndo'
  | 'canRedo'
>;

export interface HistoryHost {
  readonly read: () => EditorState;
  readonly write: (patch: Partial<HistoryPatch>) => void;
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

type HistoryAvailability = Pick<EditorState, 'canUndo' | 'canRedo'>;

function restoreHistorySnapshot(
  host: HistoryHost,
  system: TransitSystem,
  availability: HistoryAvailability | undefined,
  preserveViewport: boolean,
): void {
  const current = host.read();
  const activeWayId = current.activeWayId;
  const wayStillExists = activeWayId !== null && system.ways.some((way) => way.id === activeWayId);
  const restoredSystem =
    preserveViewport && system.viewport !== current.system.viewport
      ? { ...system, viewport: current.system.viewport }
      : system;
  host.write({
    system: restoredSystem,
    selection: null,
    armedTerminus: null,
    multiSelection: [],
    activeWayId: wayStillExists ? activeWayId : null,
    ...availability,
  });
}

/** One per editor store. System snapshots stay outside reactive Zustand data. */
export function createHistoryController(host: HistoryHost): HistoryController {
  let past: TransitSystem[] = [];
  let future: TransitSystem[] = [];
  let checkpointBefore: TransitSystem | null = null;
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
      const previous = past.pop();
      if (!previous) return;
      future.push(host.read().system);
      restoreHistorySnapshot(host, previous, availability(), true);
    },

    redo() {
      const next = future.pop();
      if (!next) return;
      appendPast(host.read().system);
      restoreHistorySnapshot(host, next, availability(), true);
    },

    beginCheckpoint() {
      checkpointDepth++;
      if (checkpointDepth === 1) {
        checkpointBefore = host.read().system;
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
      if (!changed || !before || before === host.read().system) return;
      appendPast(before);
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
      if (!changed || !before || before === host.read().system) return;
      restoreHistorySnapshot(host, before, undefined, false);
    },
  };
}
