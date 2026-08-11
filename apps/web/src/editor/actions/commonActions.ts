// What any selection lets you do, whatever it holds.

import {
  type SelectionAction,
  type SelectionActionProvider,
} from '@transitmapper/core/model/selectionActions';
import type { SelectionActionStore } from './action-store';

export function commonActionProvider(store: SelectionActionStore): SelectionActionProvider {
  return ({ refs }) => {
    if (refs.length === 0) return [];
    const actions: SelectionAction[] = [
      {
        id: 'delete',
        label: refs.length === 1 ? 'Delete' : `Delete ${refs.length} objects`,
        group: 'destructive',
        run: () => store.commands.selection.deleteMultiSelection(),
      },
    ];
    return actions;
  };
}
