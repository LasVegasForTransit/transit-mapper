import type {
  DocumentMapSnapshot,
  DocumentMapSnapshotListener,
  DocumentMapSnapshotSource,
} from '@transitmapper/map/driver';
import type { EditorState, EditorStore } from './store';

export interface EditorDocumentMapHold {
  release(): void;
  cancel(): void;
}

export interface EditorDocumentMapSource extends DocumentMapSnapshotSource {
  hold(): EditorDocumentMapHold;
}

function snapshotFor(state: EditorState): DocumentMapSnapshot {
  return Object.freeze({ status: state.documentStatus, system: state.system });
}

function sameDocument(left: DocumentMapSnapshot, state: EditorState): boolean {
  return left.status === state.documentStatus && left.system === state.system;
}

export function createDocumentMapSource(store: EditorStore): EditorDocumentMapSource {
  let current = snapshotFor(store.getState());
  const subscriptions = new Set<{ listener: DocumentMapSnapshotListener }>();
  const holds = new Set<symbol>();
  let heldSnapshotChanged = false;
  let heldReleaseRequested = false;

  const read = () => {
    const state = store.getState();
    if (!sameDocument(current, state)) current = snapshotFor(state);
    return current;
  };

  return {
    getSnapshot: read,
    hold() {
      const token = Symbol('editor-document-map-hold');
      let active = true;
      holds.add(token);
      const finish = (publish: boolean) => {
        if (!active) return;
        active = false;
        holds.delete(token);
        if (publish) heldReleaseRequested = true;
        if (holds.size > 0) return;
        const shouldPublish = heldSnapshotChanged && heldReleaseRequested;
        heldSnapshotChanged = false;
        heldReleaseRequested = false;
        if (!shouldPublish) return;
        for (const subscription of subscriptions) subscription.listener(current);
      };
      return {
        release: () => finish(true),
        cancel: () => finish(false),
      };
    },
    subscribe(listener) {
      let previous = read();
      let active = true;
      const subscription = { listener };
      subscriptions.add(subscription);
      const release = store.subscribe((state) => {
        if (sameDocument(previous, state)) return;
        previous = sameDocument(current, state) ? current : snapshotFor(state);
        current = previous;
        if (holds.size > 0) {
          heldSnapshotChanged = true;
          return;
        }
        listener(previous);
      });
      return () => {
        if (!active) return;
        active = false;
        subscriptions.delete(subscription);
        release();
      };
    },
  };
}
