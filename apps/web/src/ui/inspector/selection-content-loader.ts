let selectionContentPromise: Promise<typeof import('./selection-content')> | undefined;

export function loadSelectionInspectorContent() {
  selectionContentPromise ??= import('./selection-content');
  return selectionContentPromise;
}
