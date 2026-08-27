import type { DocumentCommands, HistoryCommands } from '../contracts/document-commands';
import type { EditorRuntime } from '../runtime';

/** Builds the document lifecycle commands once for one editor runtime. */
export function createDocumentCommands(runtime: EditorRuntime): DocumentCommands {
  return {
    setSystem(system) {
      runtime.installDocument(system, { tool: 'select' });
    },
    newSystem: runtime.newDocument,
    setName(name) {
      if (runtime.read().system.name === name) return;
      runtime.commitContent(undefined, (state) => ({
        system: { ...state.system, name },
        result: undefined,
      }));
    },
    setViewport: runtime.persistViewport,
  };
}

/** Exposes history without duplicating its per-store controller state. */
export function createHistoryCommands(runtime: EditorRuntime): HistoryCommands {
  return {
    undo: runtime.history.undo,
    redo: runtime.history.redo,
    beginHistoryCheckpoint: runtime.history.beginCheckpoint,
    commitHistoryCheckpoint: runtime.history.commitCheckpoint,
    cancelHistoryCheckpoint: runtime.history.cancelCheckpoint,
  };
}
