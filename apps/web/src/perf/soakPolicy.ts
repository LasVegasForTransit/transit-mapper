export interface SoakSnapshot {
  elapsedMs: number;
  jsHeapUsedBytes: number;
  domNodeCount: number;
  listenerCount: number;
  workerCount: number;
  webGlContextCount: number;
}

export interface SoakExerciseCounts {
  editCycles: number;
  exportDialogCycles: number;
  pngDownloadCount: number;
  svgDownloadCount: number;
}

/** Enforce the leak-growth limits after Chrome has collected both forced-GC
 * snapshots. */
export function soakViolations(
  initial: SoakSnapshot,
  final: SoakSnapshot,
  counts?: SoakExerciseCounts,
): string[] {
  const violations: string[] = [];
  if (counts) {
    if (counts.editCycles === 0) violations.push('The soak completed no edit cycles.');
    if (counts.exportDialogCycles === 0) {
      violations.push('The soak completed no export dialog cycles.');
    }
    if (counts.pngDownloadCount === 0) {
      violations.push('The soak completed no PNG downloads.');
    }
    if (counts.svgDownloadCount === 0) {
      violations.push('The soak completed no SVG downloads.');
    }
  }
  const metrics: Array<keyof Omit<SoakSnapshot, 'elapsedMs'>> = [
    'jsHeapUsedBytes',
    'domNodeCount',
    'listenerCount',
    'workerCount',
    'webGlContextCount',
  ];
  for (const metric of metrics) {
    const initialValue = initial[metric];
    const finalValue = final[metric];
    const limit = initialValue === 0 ? 0 : initialValue * 1.1;
    if (finalValue > limit) {
      violations.push(
        `${metric} grew from ${initialValue} to ${finalValue}; the 10% limit is ${limit}.`,
      );
    }
  }
  return violations;
}
