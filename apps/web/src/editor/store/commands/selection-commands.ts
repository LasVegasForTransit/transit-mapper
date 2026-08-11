import { deleteSelection } from '@transitmapper/core/model/selection-deletion';
import { nudgeSelection } from '@transitmapper/core/model/selection-nudge';
import type { MultiSelectItem, Selection } from '../contracts';
import type { SelectionCommands } from '../contracts/tool-selection-commands';
import type { EditorRuntime } from '../runtime';

function sameSelection(a: Selection, b: Selection): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind === 'service' && b.kind === 'service') return a.stopId === b.stopId;
  if (a.kind !== 'way' || b.kind !== 'way') return true;
  const left = a.relatedIds ?? [];
  const right = b.relatedIds ?? [];
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function activePatternFor(runtime: EditorRuntime, selection: Selection): string | null {
  if (selection?.kind !== 'service') return null;
  return runtime.read().system.services.find((service) => service.id === selection.id)?.id ?? null;
}

function contains(items: MultiSelectItem[], candidate: MultiSelectItem): boolean {
  return items.some((item) => item.kind === candidate.kind && item.id === candidate.id);
}

function without(items: MultiSelectItem[], candidate: MultiSelectItem): MultiSelectItem[] {
  return items.filter((item) => item.kind !== candidate.kind || item.id !== candidate.id);
}

type FocusCommands = Pick<
  SelectionCommands,
  | 'select'
  | 'setOutlineHover'
  | 'setActivePattern'
  | 'armTerminus'
  | 'clearArmedTerminus'
  | 'selectAndFocus'
>;

function createFocusCommands(runtime: EditorRuntime): FocusCommands {
  return {
    select(selection) {
      const state = runtime.read();
      const activePatternId = activePatternFor(runtime, selection);
      if (
        sameSelection(state.selection, selection) &&
        state.multiSelection.length === 0 &&
        state.activePatternId === activePatternId
      ) {
        return;
      }
      runtime.updateTransient({ selection, multiSelection: [], activePatternId });
    },
    setOutlineHover(outlineHover) {
      if (!sameSelection(runtime.read().outlineHover, outlineHover)) {
        runtime.updateTransient({ outlineHover });
      }
    },
    setActivePattern(activePatternId) {
      if (runtime.read().activePatternId !== activePatternId) {
        runtime.updateTransient({ activePatternId });
      }
    },
    armTerminus(armedTerminus) {
      runtime.updateTransient({ activePatternId: armedTerminus.patternId, armedTerminus });
    },
    clearArmedTerminus() {
      if (runtime.read().armedTerminus !== null) runtime.updateTransient({ armedTerminus: null });
    },
    selectAndFocus(selection) {
      const state = runtime.read();
      runtime.updateTransient({
        selection,
        multiSelection: [],
        activePatternId: activePatternFor(runtime, selection),
        cameraFocusToken: state.cameraFocusToken + 1,
      });
    },
  };
}

type MultiSelectionCommands = Omit<SelectionCommands, keyof FocusCommands>;

function selectionSeed(state: ReturnType<EditorRuntime['read']>, item: MultiSelectItem) {
  const selected = state.selection;
  return state.multiSelection.length === 0 &&
    selected &&
    selected.kind !== 'node' &&
    selected.kind !== 'group' &&
    !sameSelection(selected, item)
    ? [{ kind: selected.kind, id: selected.id }]
    : [];
}

function createMultiSelectionCommands(runtime: EditorRuntime): MultiSelectionCommands {
  return {
    toggleMultiSelect(item) {
      const state = runtime.read();
      const multiSelection = contains(state.multiSelection, item)
        ? without(state.multiSelection, item)
        : [...state.multiSelection, item];
      runtime.updateTransient({ multiSelection, selection: null });
    },
    extendSelection(item) {
      const state = runtime.read();
      if (contains(state.multiSelection, item)) {
        runtime.updateTransient({
          multiSelection: without(state.multiSelection, item),
          selection: null,
        });
        return;
      }
      const seed = selectionSeed(state, item);
      runtime.updateTransient({
        multiSelection: [...seed, ...state.multiSelection, item],
        selection: null,
      });
    },
    addMultiSelection(items) {
      const state = runtime.read();
      const additions = items.filter((item) => !contains(state.multiSelection, item));
      if (additions.length === 0) return;
      runtime.updateTransient({
        multiSelection: [...state.multiSelection, ...additions],
        selection: null,
      });
    },
    clearMultiSelection() {
      if (runtime.read().multiSelection.length > 0) runtime.updateTransient({ multiSelection: [] });
    },
    deleteMultiSelection() {
      if (runtime.read().multiSelection.length === 0) return;
      runtime.commitContent(undefined, (state) => ({
        system: deleteSelection(state.system, state.multiSelection),
        transient: { multiSelection: [] },
        result: undefined,
      }));
    },
    nudgeMultiSelection(dx, dy) {
      if ((dx === 0 && dy === 0) || runtime.read().multiSelection.length === 0) return;
      runtime.commitContent(undefined, (state) => ({
        system: nudgeSelection(state.system, state.multiSelection, dx, dy),
        result: undefined,
      }));
    },
  };
}

/** Builds selection commands once; content-changing group actions use one commit each. */
export function createSelectionCommands(runtime: EditorRuntime): SelectionCommands {
  return {
    ...createFocusCommands(runtime),
    ...createMultiSelectionCommands(runtime),
  };
}
