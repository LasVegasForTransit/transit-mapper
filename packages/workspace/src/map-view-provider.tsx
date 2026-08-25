import { createContext, useContext, type ReactNode } from 'react';
import type { MapViewStore } from '@transitmapper/map';

const MapViewStoreContext = createContext<MapViewStore | null>(null);

export interface MapViewProviderProps {
  store: MapViewStore;
  children: ReactNode;
}

export function MapViewProvider({ store, children }: MapViewProviderProps) {
  return <MapViewStoreContext.Provider value={store}>{children}</MapViewStoreContext.Provider>;
}

export function useMapViewStore(): MapViewStore {
  const store = useContext(MapViewStoreContext);
  if (!store) throw new Error('useMapViewStore must be used within <MapViewProvider>');
  return store;
}
