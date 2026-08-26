import { describe, expect, it } from 'vitest';
import { createPerfProtocol, PERF_SCENARIOS } from '../../src/perf/scenarios';

describe('performance protocols', () => {
  it('keeps statistical repetition in a full audit', () => {
    const protocol = createPerfProtocol('desktop', 'audit');

    expect(protocol.warmupRuns).toBe(1);
    expect(protocol.measuredRuns).toBe(5);
  });

  it('runs one measured journey and no discarded warm-up in smoke mode', () => {
    const protocol = createPerfProtocol('desktop', 'smoke');

    expect(protocol.warmupRuns).toBe(0);
    expect(protocol.measuredRuns).toBe(1);
  });

  it('gates the full viewer separately from the old read-only editor', () => {
    expect(PERF_SCENARIOS.viewer).toMatchObject({
      id: 'viewer',
      path: '/s/perfshare',
      readySelector: '.viewer-brand',
      absoluteBudgets: {
        loadMs: 2_000,
        firstContentfulPaintMs: 750,
        largestContentfulPaintMs: 1_750,
        firstMapCanvasMs: 2_000,
        longTaskTotalMs: 300,
        transferBytes: 2_000_000,
        warmLoadMs: 750,
      },
    });
  });
});
