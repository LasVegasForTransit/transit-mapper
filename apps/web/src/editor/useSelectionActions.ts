import { useMemo } from 'react';
import type {
  SelectionAction,
  SelectionRef,
  ServiceActionHit,
} from '@transitmapper/core/model/selectionActions';
import type { LngLat } from '@transitmapper/core/model/system';
import { blockedMergeNote } from './actions';
import { useEditor, useSelectionActionRegistry } from './EditorProvider';
import type { Selection } from './store';

export interface SelectionActionsView {
  /** The selection the actions apply to — empty when nothing is selected. */
  refs: SelectionRef[];
  actions: SelectionAction[];
  /** One sentence explaining a near-miss merge, or null. Rendered only by the
   *  inspector; the menu stays silent. */
  note: string | null;
}

/** A single selection as a ref list, or empty. A junction NODE and a facility
 *  GROUP are deliberately absent: neither is something a multi-selection can
 *  hold, so no provider could offer anything about a pair of them. */
function refsOfSelection(selection: Selection): SelectionRef[] {
  if (!selection || selection.kind === 'node' || selection.kind === 'group') return [];
  return [{ kind: selection.kind, id: selection.id }];
}

/**
 * The actions on offer for whatever is selected right now.
 *
 * Both surfaces call this rather than the registry, so the rule that a
 * multi-selection outranks a single selection is stated once.
 *
 * `at` is where the gesture happened, and only the right-click menu has one.
 * The inspector passes nothing, so actions anchored to a POINT — cut this line
 * where you clicked — never appear in a panel that points at nowhere.
 */
export function useSelectionActions(
  at?: LngLat,
  serviceHit?: ServiceActionHit,
): SelectionActionsView {
  const registry = useSelectionActionRegistry();
  const system = useEditor((s) => s.system);
  const multiSelection = useEditor((s) => s.multiSelection);
  const selection = useEditor((s) => s.selection);
  const readOnly = useEditor((s) => s.readOnly);

  return useMemo(() => {
    const refs = multiSelection.length > 0 ? multiSelection : refsOfSelection(selection);
    if (refs.length === 0) return { refs, actions: [], note: null };
    return {
      refs,
      actions: registry.actionsFor({ system, refs, at, serviceHit }),
      note: readOnly ? null : blockedMergeNote(system, refs),
    };
  }, [registry, system, multiSelection, selection, readOnly, at, serviceHit]);
}
