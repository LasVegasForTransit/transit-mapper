export const FIRST_SYSTEM_MAP_PAINT_MARK = 'transitmapper:first-system-map-paint';

interface PerfRunWindow extends Window {
  __TRANSITMAPPER_PERF_RUN__?: boolean;
}

export interface MapPaintInstrumentationEnvironment {
  development: boolean;
  automatedPerfRun: boolean;
}

export interface SystemPaintReadiness {
  systemDataUploaded: boolean;
  representativeSourceExists: boolean;
  representativeSourceLoaded: boolean;
}

export function mapPaintInstrumentationEnabled(
  environment: MapPaintInstrumentationEnvironment,
): boolean {
  return environment.development || environment.automatedPerfRun;
}

/** A source completion followed by MapLibre's render event proves more than
 * the canvas merely existing. One representative system source is sufficient:
 * unrelated empty/deferred sources must not hold the startup mark forever. */
export function systemPaintReady(readiness: SystemPaintReadiness): boolean {
  return (
    readiness.systemDataUploaded &&
    readiness.representativeSourceExists &&
    readiness.representativeSourceLoaded
  );
}

/** Record the first render proven to contain system data. */
export function markFirstSystemMapPaint(): void {
  if (
    !mapPaintInstrumentationEnabled({
      development: import.meta.env.DEV,
      automatedPerfRun:
        typeof window !== 'undefined' &&
        (window as PerfRunWindow).__TRANSITMAPPER_PERF_RUN__ === true,
    })
  ) {
    return;
  }
  if (performance.getEntriesByName(FIRST_SYSTEM_MAP_PAINT_MARK, 'mark').length > 0) return;
  performance.mark(FIRST_SYSTEM_MAP_PAINT_MARK);
}
