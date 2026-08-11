import { createStore, type StoreApi } from 'zustand/vanilla';
import { prunedToLiveLanes } from '@transitmapper/core/model/components';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem, Viewport } from '@transitmapper/core/model/system';
import type { CreateEditorStoreOptions } from './contracts';
import type { SetSystemOptions } from './contracts/document-commands';
import { createHistoryController, type HistoryController } from './history';
import { createInitialEditorState, type EditorState } from './state';

type MutationBlockReason = 'loading' | 'read-only';
type TransientState = Omit<
  EditorState,
  'system' | 'canUndo' | 'canRedo' | 'readOnly' | 'documentStatus'
>;
type TransientPatch = Partial<TransientState>;

interface ContentChange<Result> {
  system: TransitSystem;
  transient?: TransientPatch;
  result: Result;
}

interface InstallDocumentOptions extends SetSystemOptions {
  tool: EditorState['tool'];
}

export interface EditorRuntime {
  readonly read: () => EditorState;
  readonly getInitialState: () => EditorState;
  readonly subscribe: (listener: (state: EditorState, previous: EditorState) => void) => () => void;
  readonly updateTransient: (
    update: TransientPatch | ((state: EditorState) => TransientPatch),
  ) => void;
  readonly runContent: <Result>(blockedResult: Result, operation: () => Result) => Result;
  readonly commitContent: <Result>(
    blockedResult: Result,
    operation: (state: EditorState) => ContentChange<Result>,
  ) => Result;
  readonly installDocument: (system: TransitSystem, options: InstallDocumentOptions) => void;
  readonly newDocument: () => void;
  readonly persistViewport: (viewport: Viewport) => void;
  readonly history: HistoryController;
}

export interface EditorRuntimeOptions extends CreateEditorStoreOptions {
  /** Test/composition injection; public editor stores still install documents explicitly. */
  initialSystem?: TransitSystem;
}

function warnBlockedEdit(reason: MutationBlockReason): void {
  if (!import.meta.env.DEV) return;
  console.warn(
    reason === 'loading'
      ? '[transitmapper] refused an edit made before the saved document loaded'
      : '[transitmapper] refused an edit to a read-only document',
  );
}

function blockReason(state: EditorState): MutationBlockReason | null {
  if (state.documentStatus === 'loading') return 'loading';
  return state.readOnly ? 'read-only' : null;
}

function documentWorkflowReset(tool: EditorState['tool']): Partial<EditorState> {
  return {
    documentStatus: 'ready',
    selection: null,
    outlineHover: null,
    activePatternId: null,
    armedTerminus: null,
    multiSelection: [],
    activeWayId: null,
    routeDraft: null,
    placingFacilityForGroupId: null,
    pickingMemberForGroupId: null,
    addingServiceDraft: null,
    focusNameStationId: null,
    tool,
  };
}

function finalizedSystem(system: TransitSystem): TransitSystem {
  const turnRestrictions = prunedToLiveLanes(system.turnRestrictions, system.ways);
  return { ...system, turnRestrictions, updatedAt: Date.now() };
}

function patchChangesState(state: EditorState, patch: TransientPatch): boolean {
  return Object.entries(patch).some(
    ([key, value]) => !Object.is(state[key as keyof EditorState], value),
  );
}

/** Owns the only raw Zustand writes for one editor instance. */
export function createEditorRuntime(options: EditorRuntimeOptions = {}): EditorRuntime {
  const store: StoreApi<EditorState> = createStore<EditorState>()(() => {
    const initial = createInitialEditorState(options.documentStatus ?? 'ready');
    return options.initialSystem ? { ...initial, system: options.initialSystem } : initial;
  });
  const history = createHistoryController({
    read: store.getState,
    write: (patch) => store.setState(patch),
  });

  const updateTransient: EditorRuntime['updateTransient'] = (update) => {
    const current = store.getState();
    const patch = typeof update === 'function' ? update(current) : update;
    if (!patchChangesState(current, patch)) return;
    store.setState(patch);
  };

  const runContent: EditorRuntime['runContent'] = (blockedResult, operation) => {
    const blocked = blockReason(store.getState());
    if (!blocked) return operation();
    warnBlockedEdit(blocked);
    return blockedResult;
  };

  const commitContent: EditorRuntime['commitContent'] = (blockedResult, operation) => {
    return runContent(blockedResult, () => {
      const current = store.getState();
      const change = operation(current);
      const system =
        change.system === current.system ? current.system : finalizedSystem(change.system);
      const transient =
        change.transient && patchChangesState(current, change.transient)
          ? change.transient
          : undefined;
      if (system !== current.system || transient) {
        const availability = history.record(current.system, system);
        store.setState({ ...transient, system, ...availability });
      }
      return change.result;
    });
  };

  const installDocument = (system: TransitSystem, installOptions: InstallDocumentOptions): void => {
    const availability = history.reset();
    store.setState({
      ...documentWorkflowReset(installOptions.tool),
      ...availability,
      system,
      readOnly: installOptions.readOnly === true,
    });
  };

  return {
    read: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
    updateTransient,
    runContent,
    commitContent,
    installDocument,
    newDocument: () => installDocument(createEmptySystem(), { tool: 'way', readOnly: false }),
    persistViewport(viewport) {
      runContent(undefined, () => {
        const current = store.getState();
        const previous = current.system.viewport;
        if (
          previous.zoom === viewport.zoom &&
          previous.center[0] === viewport.center[0] &&
          previous.center[1] === viewport.center[1]
        ) {
          return;
        }
        store.setState({ system: { ...current.system, viewport } });
      });
    },
    history,
  };
}
