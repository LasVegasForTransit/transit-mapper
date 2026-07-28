import type { RawGestureMeasurements } from './gestureStats';

export interface DirectGestureMeasurements {
  inputToNextPaintMs: number[];
  animationFrameMs: number[];
  /** Painted MapLibre frames captured across the trusted pointer actions.
   * Null when a surface does not install the map capture seam. */
  paintedFrameMs?: number[] | null;
  longTaskMs: number[];
  sourceUploadCount: number | null;
}

/**
 * Assemble the measurements used by the direct-manipulation hard gate.
 *
 * The scripted pan is accepted separately because it is useful attribution,
 * while the direct pointer run remains the source of Event Timing data.
 */
export function directGestureGateMeasurements(
  direct: DirectGestureMeasurements,
  _scriptedPan: RawGestureMeasurements | null,
): RawGestureMeasurements {
  return {
    inputToNextPaintMs: direct.inputToNextPaintMs,
    paintedFrameMs: direct.paintedFrameMs ?? direct.animationFrameMs,
    longTaskMs: direct.longTaskMs,
    sourceUploadCount: direct.sourceUploadCount,
  };
}
