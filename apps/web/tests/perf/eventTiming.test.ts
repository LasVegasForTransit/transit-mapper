import { describe, expect, it } from 'vitest';
import { eventTimingInteractionDurations } from '../../src/perf/eventTiming';

describe('Event Timing interaction aggregation', () => {
  it('ignores entries without a browser-assigned interaction ID', () => {
    expect(
      eventTimingInteractionDurations([
        {
          name: 'pointerover',
          interactionId: 0,
          duration: 2_040,
          startTime: 100,
        },
        {
          name: 'pointermove',
          interactionId: 0,
          duration: 1_984,
          startTime: 120,
        },
      ]),
    ).toEqual([]);
  });

  it('uses the longest sibling entry once for each physical interaction', () => {
    expect(
      eventTimingInteractionDurations([
        {
          name: 'pointerdown',
          interactionId: 41,
          duration: 32,
          startTime: 100,
        },
        {
          name: 'pointerup',
          interactionId: 41,
          duration: 48,
          startTime: 120,
        },
        {
          name: 'click',
          interactionId: 41,
          duration: 40,
          startTime: 121,
        },
        {
          name: 'keydown',
          interactionId: 42,
          duration: 24,
          startTime: 140,
        },
        {
          name: 'keyup',
          interactionId: 42,
          duration: 16,
          startTime: 150,
        },
      ]),
    ).toEqual([48, 24]);
  });
});
