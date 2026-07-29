import type { EditorStore } from '../editor/store';

/** A view owns which editor gestures are meaningful; none may stay armed
 * across a view boundary where the same rendered target has new semantics. */
export function clearArmedTerminusForViewChange(store: EditorStore): void {
  store.getState().clearArmedTerminus();
}
