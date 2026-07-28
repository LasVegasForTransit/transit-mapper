export interface DisplayCadenceSummary {
  displayFrameIntervalMedianMs: number;
  estimatedDisplayRefreshHz: number;
}

/** Summarize the display environment without changing any performance gate. */
export function summarizeDisplayCadence(samplesMs: number[]): DisplayCadenceSummary {
  if (
    samplesMs.length === 0 ||
    samplesMs.some((sample) => !Number.isFinite(sample) || sample <= 0)
  ) {
    throw new Error('Display cadence samples must be finite positive numbers.');
  }
  const sorted = [...samplesMs].sort((left, right) => left - right);
  const displayFrameIntervalMedianMs = sorted[Math.floor(sorted.length / 2)];
  return {
    displayFrameIntervalMedianMs,
    estimatedDisplayRefreshHz: 1_000 / displayFrameIntervalMedianMs,
  };
}
