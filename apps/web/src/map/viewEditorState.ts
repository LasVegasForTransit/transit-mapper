interface ViewSelectionCommands {
  readonly clearArmedTerminus: () => void;
}

interface ViewCommandGroups {
  selection: ViewSelectionCommands;
}

export interface ViewEditorPort {
  readonly commands: ViewCommandGroups;
}

/** A view owns which editor gestures are meaningful; none may stay armed
 * across a view boundary where the same rendered target has new semantics. */
export function clearArmedTerminusForViewChange(store: ViewEditorPort): void {
  store.commands.selection.clearArmedTerminus();
}
