import { describe, expect, it } from 'vitest';
import { combineProductionPersistence } from '../../scripts/perf/production-persistence';

describe('production persistence samples', () => {
  it('keeps the slower observed value for each cold and warm persistence phase', () => {
    expect(
      combineProductionPersistence({
        cold: { saveMs: 20, serializationMs: 8, indexedDbWriteMs: 2 },
        warm: { saveMs: 15, serializationMs: 10, indexedDbWriteMs: 1 },
      }),
    ).toEqual({ saveMs: 20, serializationMs: 10, indexedDbWriteMs: 2 });
  });

  it('keeps the one production sample supplied by a partial journey', () => {
    const warm = { saveMs: 15, serializationMs: 10, indexedDbWriteMs: 1 };

    expect(combineProductionPersistence({ cold: null, warm })).toBe(warm);
    expect(combineProductionPersistence({ cold: null, warm: null })).toBeUndefined();
  });
});
