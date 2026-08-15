let selectionContentPromise: Promise<typeof import('./selection-content')> | undefined;

export function loadSelectionInspectorContent() {
  selectionContentPromise ??= import('./selection-content');
  return selectionContentPromise;
}

/** Pointer-down can begin the request before pointer-up commits selection.
 * Reusing one promise keeps rapid clicks and React.lazy on one module fetch. */
export function preloadSelectionInspectorContent(): void {
  void loadSelectionInspectorContent();
}
