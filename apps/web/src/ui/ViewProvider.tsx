import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import { createMapViewStore, type MapViewStore } from '@transitmapper/map';
import type { MapCameraStateV1 } from '@transitmapper/views';
import { MapViewProvider, useMapViewStore } from '@transitmapper/workspace';
import {
  DOCUMENT_VIEW_FILTER_IDS,
  type DocumentRepresentationId,
} from '@transitmapper/renderer/presentation';
import { createDocumentPresentationState } from '../editor/document-view-adapter';

export type { DocumentRepresentationId } from '@transitmapper/renderer/presentation';
export type ViewMode = DocumentRepresentationId;

interface ViewState {
  viewMode: DocumentRepresentationId;
  setViewMode: (mode: DocumentRepresentationId) => void;
  visibleModes: Set<string>;
  visibleWayTypes: Set<string>;
  toggleMode: (id: string) => void;
  toggleWayType: (id: string) => void;
  showAllModes: () => void;
  showAllWayTypes: () => void;
  showLandmarks: boolean;
  toggleLandmarks: () => void;
}

const ViewContext = createContext<ViewState | null>(null);

interface ViewControlSnapshot {
  representationId: string;
  filters: ReturnType<MapViewStore['getSnapshot']>['filters'];
}

function useViewControlSnapshot(store: MapViewStore): ViewControlSnapshot {
  const current = useRef<ViewControlSnapshot | null>(null);
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => {
    const state = store.getSnapshot();
    if (
      current.current?.representationId === state.representationId &&
      current.current.filters === state.filters
    ) {
      return current.current;
    }
    current.current = {
      representationId: state.representationId,
      filters: state.filters,
    };
    return current.current;
  }, [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function stringSet(value: unknown, fallback: readonly string[]): Set<string> {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return new Set(fallback);
  }
  return new Set(value);
}

function toggleInSet(set: Set<string>, id: string): string[] {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return [...next];
}

interface ViewProviderProps {
  children: ReactNode;
  initialViewMode?: DocumentRepresentationId;
  initialCamera?: MapCameraStateV1;
  store?: MapViewStore;
}

export function ViewProvider({
  children,
  initialViewMode = 'network',
  initialCamera,
  store,
}: ViewProviderProps) {
  const [ownedStore] = useState(() =>
    createMapViewStore(
      createDocumentPresentationState({
        camera: initialCamera,
        representationId: initialViewMode,
      }),
    ),
  );
  const viewStore = store ?? ownedStore;
  const snapshot = useViewControlSnapshot(viewStore);
  const visibleModes = useMemo(
    () => stringSet(snapshot.filters[DOCUMENT_VIEW_FILTER_IDS.modes], MODE_ORDER),
    [snapshot.filters],
  );
  const visibleWayTypes = useMemo(
    () => stringSet(snapshot.filters[DOCUMENT_VIEW_FILTER_IDS.wayTypes], WAY_TYPE_ORDER),
    [snapshot.filters],
  );
  const landmarks = snapshot.filters[DOCUMENT_VIEW_FILTER_IDS.landmarks];
  const showLandmarks = typeof landmarks === 'boolean' ? landmarks : true;

  const actions = useMemo<
    Omit<ViewState, 'viewMode' | 'visibleModes' | 'visibleWayTypes' | 'showLandmarks'>
  >(
    () => ({
      setViewMode: (mode) => viewStore.setRepresentationId(mode),
      toggleMode: (id) => {
        const modes = stringSet(
          viewStore.getSnapshot().filters[DOCUMENT_VIEW_FILTER_IDS.modes],
          MODE_ORDER,
        );
        viewStore.setFilter(DOCUMENT_VIEW_FILTER_IDS.modes, toggleInSet(modes, id));
      },
      toggleWayType: (id) => {
        const wayTypes = stringSet(
          viewStore.getSnapshot().filters[DOCUMENT_VIEW_FILTER_IDS.wayTypes],
          WAY_TYPE_ORDER,
        );
        viewStore.setFilter(DOCUMENT_VIEW_FILTER_IDS.wayTypes, toggleInSet(wayTypes, id));
      },
      showAllModes: () => viewStore.setFilter(DOCUMENT_VIEW_FILTER_IDS.modes, MODE_ORDER),
      showAllWayTypes: () => viewStore.setFilter(DOCUMENT_VIEW_FILTER_IDS.wayTypes, WAY_TYPE_ORDER),
      toggleLandmarks: () => {
        const value = viewStore.getSnapshot().filters[DOCUMENT_VIEW_FILTER_IDS.landmarks];
        viewStore.setFilter(
          DOCUMENT_VIEW_FILTER_IDS.landmarks,
          !(typeof value === 'boolean' ? value : true),
        );
      },
    }),
    [viewStore],
  );
  const value = useMemo<ViewState>(
    () => ({
      viewMode: snapshot.representationId as DocumentRepresentationId,
      visibleModes,
      visibleWayTypes,
      showLandmarks,
      ...actions,
    }),
    [snapshot.representationId, visibleModes, visibleWayTypes, showLandmarks, actions],
  );
  return (
    <MapViewProvider store={viewStore}>
      <ViewContext.Provider value={value}>{children}</ViewContext.Provider>
    </MapViewProvider>
  );
}

export { useMapViewStore };

export function useView(): ViewState {
  const view = useContext(ViewContext);
  if (!view) throw new Error('useView must be used within <ViewProvider>');
  return view;
}
