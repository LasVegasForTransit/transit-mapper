import { describe, expect, it } from 'vitest';
import { directGestureGateMeasurements } from './gestureGate';

describe('direct-manipulation frame gate', () => {
  it('gates the frames and work produced by the trusted pointer actions', () => {
    const measurements = directGestureGateMeasurements(
      {
        inputToNextPaintMs: [18],
        animationFrameMs: [16],
        paintedFrameMs: [21, 24],
        longTaskMs: [55],
        sourceUploadCount: 3,
      },
      {
        inputToNextPaintMs: [9],
        paintedFrameMs: [11, 12],
        longTaskMs: [70],
        sourceUploadCount: 8,
      },
    );

    expect(measurements).toEqual({
      inputToNextPaintMs: [18],
      paintedFrameMs: [21, 24],
      longTaskMs: [55],
      sourceUploadCount: 3,
    });
  });

  it('falls back to animation frames only when the surface has no map capture seam', () => {
    const measurements = directGestureGateMeasurements(
      {
        inputToNextPaintMs: [18],
        animationFrameMs: [15, 17],
        paintedFrameMs: null,
        longTaskMs: [],
        sourceUploadCount: null,
      },
      null,
    );

    expect(measurements.paintedFrameMs).toEqual([15, 17]);
  });
});
