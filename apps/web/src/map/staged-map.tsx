import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import type { MapCanvasProps } from './MapCanvas';

interface MapCanvasModule {
  default: ComponentType<MapCanvasProps>;
}

export interface StagedMapCanvasProps extends MapCanvasProps {
  /** Test seam for the import boundary. Production always uses the real
   * MapCanvas module, but the seam lets the shell-before-import guarantee be
   * proved without evaluating MapLibre under jsdom. */
  load?: () => Promise<MapCanvasModule>;
  /** Lets document bootstrap yield until React can mount the real map. */
  onModuleReady?: () => void;
}

function loadMapCanvas(): Promise<MapCanvasModule> {
  return import('./MapCanvas').then((module) => ({ default: module.MapCanvas }));
}

function MapShell() {
  return (
    <div className="map-loading-shell" data-map-shell="loading">
      <p role="status" aria-live="polite">
        Preparing map…
      </p>
    </div>
  );
}

/**
 * Starts the MapLibre chunk during the first Suspense render. The shell stays
 * in the map surface while that import resolves, so code loading and useful
 * feedback happen in parallel instead of adding a passive-effect turn to the
 * cold path.
 */
export function StagedMapCanvas({
  load = loadMapCanvas,
  onModuleReady,
  ...props
}: StagedMapCanvasProps) {
  const [modulePromise] = useState(load);
  const [MapCanvas] = useState(() => lazy(() => modulePromise));

  useEffect(() => {
    let active = true;
    void modulePromise.then(() => {
      if (active) onModuleReady?.();
    });
    return () => {
      active = false;
    };
  }, [modulePromise, onModuleReady]);

  return (
    <Suspense fallback={<MapShell />}>
      <MapCanvas {...props} />
    </Suspense>
  );
}
