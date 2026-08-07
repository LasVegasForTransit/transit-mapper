import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { SelectionActionRegistry } from '@transitmapper/core/model/selectionActions';
import { createSelectionActions } from './actions';
import { createEditorStore, type EditorState, type EditorStore } from './store';

// The editor store is created once and shared through context, so React
// components consume it via hooks and the imperative map/keyboard layers
// receive the same instance by injection — no module-level singleton.
const EditorStoreContext = createContext<EditorStore | null>(null);

// The action registry is bound to that one store, so it travels the same way
// rather than being rebuilt per consumer.
const SelectionActionsContext = createContext<SelectionActionRegistry | null>(null);

interface EditorProviderProps {
  children: ReactNode;
}

export function EditorProvider({ children }: EditorProviderProps) {
  const storeRef = useRef<EditorStore | null>(null);
  // `loading`, because the running editor always goes looking in storage (or
  // at a shared link) for the document it should be showing. The empty system
  // the store starts with is a placeholder for that, and the store refuses
  // content changes to it until the real one lands — see documentStatus.
  if (storeRef.current === null)
    storeRef.current = createEditorStore({ documentStatus: 'loading' });
  const actionsRef = useRef<SelectionActionRegistry | null>(null);
  if (actionsRef.current === null) actionsRef.current = createSelectionActions(storeRef.current);

  useEffect(() => {
    if (import.meta.env.DEV) {
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

/** The store instance, for imperative access (getState / subscribe / actions). */
export function useEditorStore(): EditorStore {
  const store = useContext(EditorStoreContext);
  if (!store) throw new Error('useEditorStore must be used within <EditorProvider>');
  return store;
}

/** Subscribe to a slice of editor state. */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(useEditorStore(), selector);
}
