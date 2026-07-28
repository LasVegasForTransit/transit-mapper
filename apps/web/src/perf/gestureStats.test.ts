import { describe, expect, it } from 'vitest';
import { summarizeGesture } from './gestureStats';

describe('direct-manipulation performance', () => {
  it('derives hard-gate metrics from raw pan measurements', () => {
    const summary = summarizeGesture({
      inputToNextPaintMs: [10, 20, 30, 40, 50],
      paintedFrameMs: [10, 16.7, 33.3, 33.31, 50],
      longTaskMs: [49.9, 50, 50.01, 75],
      sourceUploadCount: 2,
    });

    expect(summary.metrics).toEqual({
      inputToNextPaintP95Ms: 50,
      paintedFrameP95Ms: 50,
      paintedFramesOver33Ratio: 0.4,
      maxUnexpectedLongTaskMs: 75,
    });
    expect(summary.counters).toEqual({
      sourceUploadCount: 2,
      paintedFrameCount: 5,
      unexpectedLongTaskCount: 2,
    });
  });

  it('reports zero instead of inventing a long task when none exceeds fifty milliseconds', () => {
    const summary = summarizeGesture({
      inputToNextPaintMs: [10],
      paintedFrameMs: [16],
      longTaskMs: [],
      sourceUploadCount: 0,
    });

    expect(summary.metrics.maxUnexpectedLongTaskMs).toBe(0);
    expect(summary.counters.unexpectedLongTaskCount).toBe(0);
  });
});
