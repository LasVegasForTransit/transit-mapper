import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import type { MapViewStore } from '@transitmapper/map';
import { useMapViewStore } from '@transitmapper/workspace';
import {
  DOCUMENT_VIEW_FILTER_IDS,
  type DocumentRepresentationId,
} from '@transitmapper/renderer/presentation';

export type ViewMode = DocumentRepresentationId;

export interface DocumentViewControls {
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

function toggleInSet(set: ReadonlySet<string>, id: string): string[] {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return [...next];
}

export function useDocumentView(): DocumentViewControls {
  const store = useMapViewStore();
  const snapshot = useViewControlSnapshot(store);
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

  return useMemo(
    () => ({
      viewMode: snapshot.representationId as DocumentRepresentationId,
      setViewMode: (mode: DocumentRepresentationId) => store.setRepresentationId(mode),
      visibleModes,
      visibleWayTypes,
      toggleMode: (id: string) =>
        store.setFilter(
          DOCUMENT_VIEW_FILTER_IDS.modes,
          toggleInSet(
            stringSet(store.getSnapshot().filters[DOCUMENT_VIEW_FILTER_IDS.modes], MODE_ORDER),
            id,
          ),
        ),
      toggleWayType: (id: string) =>
        store.setFilter(
          DOCUMENT_VIEW_FILTER_IDS.wayTypes,
          toggleInSet(
            stringSet(
              store.getSnapshot().filters[DOCUMENT_VIEW_FILTER_IDS.wayTypes],
              WAY_TYPE_ORDER,
            ),
            id,
          ),
        ),
      showAllModes: () => store.setFilter(DOCUMENT_VIEW_FILTER_IDS.modes, MODE_ORDER),
      showAllWayTypes: () => store.setFilter(DOCUMENT_VIEW_FILTER_IDS.wayTypes, WAY_TYPE_ORDER),
      showLandmarks,
      toggleLandmarks: () => {
        const value = store.getSnapshot().filters[DOCUMENT_VIEW_FILTER_IDS.landmarks];
        store.setFilter(
          DOCUMENT_VIEW_FILTER_IDS.landmarks,
          !(typeof value === 'boolean' ? value : true),
        );
      },
    }),
    [showLandmarks, snapshot.representationId, store, visibleModes, visibleWayTypes],
  );
}
