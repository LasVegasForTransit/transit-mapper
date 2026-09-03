import type * as SelectionContentModule from './selection-content';

let selectionContentPromise: Promise<typeof SelectionContentModule> | undefined;

export function loadSelectionInspectorContent() {
  selectionContentPromise ??= import('./selection-content');
  return selectionContentPromise;
}
