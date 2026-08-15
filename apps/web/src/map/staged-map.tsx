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
 * Commits a useful editor shell before MapLibre parses. A passive effect runs
 * after React has presented that shell, then starts exactly one dynamic import
 * immediately; it is deliberately not an idle-time optimization. The same
 * fallback occupies the map surface until the real canvas takes over, so the
 * editor never flashes an empty or inert-looking page.
 */
export function StagedMapCanvas({ load = loadMapCanvas, ...props }: StagedMapCanvasProps) {
  const [requested, setRequested] = useState(false);
  const [MapCanvas] = useState(() => lazy(load));

  useEffect(() => {
    setRequested(true);
  }, []);

  if (!requested) return <MapShell />;
  return (
    <Suspense fallback={<MapShell />}>
      <MapCanvas {...props} />
    </Suspense>
  );
}
