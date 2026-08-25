import type { SelectionController } from '@transitmapper/map';
import type { MapFeatureReferenceV1 } from '@transitmapper/views';
import { editorSelectionReference, restoreEditorSelection } from './document-view-adapter';
import type { EditorState, EditorStore } from './store';

function referencesEqual(
  left: MapFeatureReferenceV1 | undefined,
  right: MapFeatureReferenceV1 | undefined,
): boolean {
  return (
    left === right ||
    (left?.source === right?.source && left?.kind === right?.kind && left?.id === right?.id)
  );
}

function referenceFor(state: EditorState): MapFeatureReferenceV1 | undefined {
  const reference = editorSelectionReference(state.selection);
  return reference === undefined ? undefined : Object.freeze(reference);
}

export function createEditorSelectionController(store: EditorStore): SelectionController {
  let current = referenceFor(store.getState());

  const read = () => {
    const next = referenceFor(store.getState());
    if (!referencesEqual(current, next)) current = next;
    return current;
  };

  return {
    getSnapshot: read,
    select(reference) {
      if (referencesEqual(read(), reference)) return;
      store.commands.selection.select(restoreEditorSelection(reference, store.getState().system));
    },
    subscribe(listener) {
      let previous = read();
      let active = true;
      const release = store.subscribe((state) => {
        const next = referenceFor(state);
        if (referencesEqual(previous, next)) return;
        previous = referencesEqual(current, next) ? current : next;
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
