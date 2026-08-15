import { FIRST_SYSTEM_PAINT_MARK, markOnce } from './startup-marks';

/** Compatibility name retained for the existing performance harness. */
export const FIRST_SYSTEM_MAP_PAINT_MARK = FIRST_SYSTEM_PAINT_MARK;

export interface SystemPaintReadiness {
  documentReady: boolean;
  systemDataUploaded: boolean;
  systemDataMatchesDocument: boolean;
  representativeSourceExists: boolean;
  representativeSourceLoaded: boolean;
}

export interface SystemInteractionReadiness {
  documentCommitted: boolean;
  interactionsAttached: boolean;
}

/** A source completion followed by MapLibre's render event proves more than
 * the canvas merely existing. One representative system source is sufficient:
 * unrelated empty/deferred sources must not hold the startup mark forever. */
export function systemPaintReady(readiness: SystemPaintReadiness): boolean {
  return (
    readiness.documentReady &&
    readiness.systemDataUploaded &&
    readiness.systemDataMatchesDocument &&
    readiness.representativeSourceExists &&
    readiness.representativeSourceLoaded
  );
}

/** Interaction readiness begins only after React has committed the real
 * document and the map's input adapters are attached to that committed UI. */
export function systemInteractiveReady(readiness: SystemInteractionReadiness): boolean {
  return readiness.documentCommitted && readiness.interactionsAttached;
}

/** Record the first render proven to contain system data. */
export function markFirstSystemMapPaint(): void {
  markOnce(FIRST_SYSTEM_MAP_PAINT_MARK);
}
