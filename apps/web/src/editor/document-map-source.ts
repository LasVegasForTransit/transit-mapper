import type {
  DocumentMapSnapshot,
  DocumentMapSnapshotSource,
} from '@transitmapper/renderer/driver';
import type { EditorState, EditorStore } from './store';

function snapshotFor(state: EditorState): DocumentMapSnapshot {
  return Object.freeze({ status: state.documentStatus, system: state.system });
}

function sameDocument(left: DocumentMapSnapshot, state: EditorState): boolean {
  return left.status === state.documentStatus && left.system === state.system;
}

export function createDocumentMapSource(store: EditorStore): DocumentMapSnapshotSource {
  let current = snapshotFor(store.getState());

  const read = () => {
    const state = store.getState();
    if (!sameDocument(current, state)) current = snapshotFor(state);
    return current;
  };

  return {
    getSnapshot: read,
    subscribe(listener) {
      let previous = read();
      let active = true;
      const release = store.subscribe((state) => {
        if (sameDocument(previous, state)) return;
        previous = sameDocument(current, state) ? current : snapshotFor(state);
        current = previous;
        listener(previous);
      });
      return () => {
        if (!active) return;
        active = false;
        release();
      };
    },
  };
}
