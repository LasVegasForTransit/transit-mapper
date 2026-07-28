import type { LngLat } from '@transitmapper/core/model/system';

export interface CameraProofSnapshot {
  center: LngLat;
  zoom: number;
}

export interface SystemProofSnapshot {
  revision: number;
  wayCount: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
}

/** A performance action is not evidence unless the camera actually moved. */
export function cameraChanged(before: CameraProofSnapshot, after: CameraProofSnapshot): boolean {
  return (
    before.center[0] !== after.center[0] ||
    before.center[1] !== after.center[1] ||
    before.zoom !== after.zoom
  );
}

/** A geographic target moving on screen proves a non-embed map camera changed
 * without exposing MapLibre's camera object to the production bundle. */
export function projectedPointChanged(before: ProjectedPoint, after: ProjectedPoint): boolean {
  return before.x !== after.x || before.y !== after.y;
}

/** The deterministic Alt-draw deliberately creates separate infrastructure,
 * so both the immutable system revision and model way count must advance. */
export function drawChangedSystem(
  before: SystemProofSnapshot,
  after: SystemProofSnapshot,
): boolean {
  return after.revision !== before.revision && after.wayCount > before.wayCount;
}
