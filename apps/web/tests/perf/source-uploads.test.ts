import { describe, expect, it } from 'vitest';
import { sourceUploadCountsBetween } from '../../src/perf/source-uploads';

describe('performance source upload attribution', () => {
  it('reports mutation counts added during one measured interval', () => {
    const before = [
      {
        sourceId: 'ways',
        method: 'setData' as const,
        callCount: 2,
        totalDurationMs: 8,
        maxDurationMs: 6,
      },
    ];
    const after = [
      {
        sourceId: 'ways',
        method: 'setData' as const,
        callCount: 5,
        totalDurationMs: 17,
        maxDurationMs: 6,
      },
      {
        sourceId: 'handles',
        method: 'updateData' as const,
        callCount: 4,
        totalDurationMs: 3,
        maxDurationMs: 1,
      },
    ];

    expect(sourceUploadCountsBetween(before, after)).toEqual([
      { sourceId: 'handles', method: 'updateData', callCount: 4 },
      { sourceId: 'ways', method: 'setData', callCount: 3 },
    ]);
  });

  it('omits sources that did not mutate during the interval', () => {
    const snapshot = [
      {
        sourceId: 'stations',
        method: 'setData' as const,
        callCount: 1,
        totalDurationMs: 2,
        maxDurationMs: 2,
      },
    ];

    expect(sourceUploadCountsBetween(snapshot, snapshot)).toEqual([]);
  });
});
