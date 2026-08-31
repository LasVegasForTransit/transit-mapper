/**
 * The one percentile implementation for the performance suite.
 *
 * The suite previously carried two: a round-rank on n − 1 in frameStats and
 * this ceil-rank on n in the report. They disagreed on small sample counts
 * (four samples at p50: index 2 versus index 1), which is exactly the count
 * a five-run protocol produces. Ceil-rank survives because every recorded
 * gate value was computed with it, so consolidating on it moves no gate.
 */
export function percentile(sorted: number[], percentileValue: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}
