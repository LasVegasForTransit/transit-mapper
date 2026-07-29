import { describe, expect, it } from 'vitest';
import { soakViolations, type SoakSnapshot } from '../../src/perf/soakPolicy';

const stableSnapshot: SoakSnapshot = {
  elapsedMs: 0,
  jsHeapUsedBytes: 100,
  domNodeCount: 100,
  listenerCount: 10,
  workerCount: 2,
  webGlContextCount: 1,
};

describe('performance soak policy', () => {
  it('fails a soak that never exercised both edit and export lifecycles', () => {
    const violations = soakViolations(stableSnapshot, stableSnapshot, {
      editCycles: 0,
      exportDialogCycles: 0,
      pngDownloadCount: 0,
      svgDownloadCount: 0,
    });

    expect(violations).toEqual([
      'The soak completed no edit cycles.',
      'The soak completed no export dialog cycles.',
      'The soak completed no PNG downloads.',
      'The soak completed no SVG downloads.',
    ]);
  });

  it('accepts stable resources after both lifecycle loops ran', () => {
    expect(
      soakViolations(stableSnapshot, stableSnapshot, {
        editCycles: 1,
        exportDialogCycles: 1,
        pngDownloadCount: 1,
        svgDownloadCount: 1,
      }),
    ).toEqual([]);
  });

  it('uses the warmed run as the baseline for stable feature resources', () => {
    const featureSnapshot: SoakSnapshot = {
      ...stableSnapshot,
      jsHeapUsedBytes: 50_000_000,
      domNodeCount: 2_500,
      listenerCount: 75,
      workerCount: 3,
      webGlContextCount: 2,
    };

    expect(
      soakViolations(featureSnapshot, featureSnapshot, {
        editCycles: 1,
        exportDialogCycles: 2,
        pngDownloadCount: 1,
        svgDownloadCount: 1,
      }),
    ).toEqual([]);
  });
});
