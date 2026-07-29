import { describe, expect, it } from 'vitest';
import { createPerfProtocol } from '../../src/perf/scenarios';

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
});
