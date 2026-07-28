import { summarizeMetric } from './report';

export interface RawGestureMeasurements {
  inputToNextPaintMs: number[];
  paintedFrameMs: number[];
  longTaskMs: number[];
  sourceUploadCount: number | null;
}

export interface GestureGateMetrics {
  inputToNextPaintP95Ms: number;
  paintedFrameP95Ms: number;
  paintedFramesOver33Ratio: number;
  maxUnexpectedLongTaskMs: number;
}

export interface GestureCounters {
  sourceUploadCount: number | null;
  paintedFrameCount: number;
  unexpectedLongTaskCount: number;
}

export interface GestureSummary {
  metrics: GestureGateMetrics;
  counters: GestureCounters;
}

export function summarizeGesture(measurements: RawGestureMeasurements): GestureSummary {
  const unexpectedLongTasks = measurements.longTaskMs.filter((duration) => duration > 50);
  const framesOver33 = measurements.paintedFrameMs.filter((duration) => duration > 33.3).length;

  return {
    metrics: {
      inputToNextPaintP95Ms: summarizeMetric(measurements.inputToNextPaintMs).p95,
      paintedFrameP95Ms: summarizeMetric(measurements.paintedFrameMs).p95,
      paintedFramesOver33Ratio:
        measurements.paintedFrameMs.length === 0
          ? 0
          : framesOver33 / measurements.paintedFrameMs.length,
      maxUnexpectedLongTaskMs:
        unexpectedLongTasks.length === 0 ? 0 : Math.max(...unexpectedLongTasks),
    },
    counters: {
      sourceUploadCount: measurements.sourceUploadCount,
      paintedFrameCount: measurements.paintedFrameMs.length,
      unexpectedLongTaskCount: unexpectedLongTasks.length,
    },
  };
}
