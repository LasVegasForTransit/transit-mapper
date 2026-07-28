// What any selection lets you do, whatever it holds.

import {
  type SelectionAction,
  type SelectionActionProvider,
} from '@transitmapper/core/model/selectionActions';
import type { EditorStore } from '../store';

export function commonActionProvider(store: EditorStore): SelectionActionProvider {
  return ({ refs }) => {
    if (refs.length === 0) return [];
    const actions: SelectionAction[] = [
      {
        id: 'delete',
        label: refs.length === 1 ? 'Delete' : `Delete ${refs.length} objects`,
        group: 'destructive',
        run: () => store.getState().deleteMultiSelection(),
      },
    ];
    return actions;
  };
}
