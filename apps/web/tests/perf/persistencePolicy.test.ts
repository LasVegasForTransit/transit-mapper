import { describe, expect, it } from 'vitest';
import {
  classifyPersistence,
  INDEXED_DB_THRESHOLD_BYTES,
  OFF_THREAD_SERIALIZATION_THRESHOLD_MS,
} from '../../src/perf/persistencePolicy';

describe('large-system persistence policy', () => {
  it('flags the database and off-thread boundary from measured phases', () => {
    const result = classifyPersistence({
      serializedBytes: 5_885_468,
      parseMs: 45,
      serializationMs: 80,
      localStorageWriteMs: 4,
      localStorageWriteOutcome: 'quota-exceeded',
    });

    expect(result).toMatchObject({
      offThreadSerializationThresholdMs: OFF_THREAD_SERIALIZATION_THRESHOLD_MS,
      indexedDbThresholdBytes: INDEXED_DB_THRESHOLD_BYTES,
      recommendOffThreadSerialization: true,
      recommendIndexedDb: true,
    });
  });

  it('keeps a small fast document on the current path', () => {
    const result = classifyPersistence({
      serializedBytes: 200_000,
      parseMs: 4,
      serializationMs: 8,
      localStorageWriteMs: 3,
      localStorageWriteOutcome: 'stored',
    });

    expect(result.recommendOffThreadSerialization).toBe(false);
    expect(result.recommendIndexedDb).toBe(false);
  });
});
