import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { SelectionActionRegistry } from '@transitmapper/core/model/selectionActions';
import type { BackgroundImportStore } from '../import/background-import-store';
import { createSelectionActions } from './actions';
import {
  createEditorStore,
  type EditorCommands,
  type EditorState,
  type EditorStore,
} from './store';

// The editor store is created once and shared through context, so React
// components consume it via hooks and the imperative map/keyboard layers
// receive the same instance by injection — no module-level singleton.
const EditorStoreContext = createContext<EditorStore | null>(null);

// Deterministic renderer captures seed and manipulate fixtures through this
// store. A performance build is still a local harness, not a production
// release, so it needs the same seam that development uses.
const EXPOSE_EDITOR_STORE = import.meta.env.DEV || import.meta.env.VITE_PERF_BUILD === '1';

// The action registry is bound to that one store, so it travels the same way
// rather than being rebuilt per consumer.
const SelectionActionsContext = createContext<SelectionActionRegistry | null>(null);

interface EditorProviderProps {
  children: ReactNode;
  /** A real editor store may be injected by tests and embedded editors. */
  store?: EditorStore;
}

export function EditorProvider({ children, store: providedStore }: EditorProviderProps) {
  const storeRef = useRef<EditorStore | null>(null);
  // `loading`, because the running editor always looks in local storage for
  // the document it should show. The empty system the store starts with is a
  // placeholder for that, and the store refuses content changes until the
  // real document lands — see documentStatus.
  storeRef.current ??= providedStore ?? createEditorStore({ documentStatus: 'loading' });
  const actionsRef = useRef<SelectionActionRegistry | null>(null);
  actionsRef.current ??= createSelectionActions(storeRef.current);

  useEffect(() => {
    if (EXPOSE_EDITOR_STORE) {
      (window as unknown as { __editor?: unknown }).__editor = storeRef.current;
    }
  }, []);

  return (
    <EditorStoreContext.Provider value={storeRef.current}>
      <SelectionActionsContext.Provider value={actionsRef.current}>
        {children}
      </SelectionActionsContext.Provider>
    </EditorStoreContext.Provider>
  );
}

/** The action registry for the current selection — see editor/actions. */
export function useSelectionActionRegistry(): SelectionActionRegistry {
  const registry = useContext(SelectionActionsContext);
  if (!registry) throw new Error('useSelectionActionRegistry must be used within <EditorProvider>');
  return registry;
}

/** The store instance, for imperative access (getState / subscribe / commands). */
export function useEditorStore(): EditorStore {
  const store = useContext(EditorStoreContext);
  if (!store) throw new Error('useEditorStore must be used within <EditorProvider>');
  return store;
}

/** Stable command functions for the current editor store. */
export function useEditorCommands(): EditorCommands {
  return useEditorStore().commands;
}

/** Snapshot/subscription port for imports that outlive a React event. */
export function useBackgroundImportStore(): BackgroundImportStore {
  return useEditorStore();
}

/** Subscribe to a slice of editor state. */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(useEditorStore(), selector);
}
