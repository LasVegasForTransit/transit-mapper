import type { PerfPersistenceProbe, PerfStorageWriteOutcome } from './types';

/** Above one long-task boundary, JSON work belongs off the main thread. */
export const OFF_THREAD_SERIALIZATION_THRESHOLD_MS = 50;

/**
 * localStorage quotas vary by browser and device. Four megabytes leaves room
 * for the library index and browser accounting before the common 5 MiB edge.
 */
export const INDEXED_DB_THRESHOLD_BYTES = 4_000_000;

export interface ClassifyPersistenceOptions {
  serializedBytes: number;
  parseMs: number;
  serializationMs: number;
  localStorageWriteMs: number;
  localStorageWriteOutcome: PerfStorageWriteOutcome;
}

export function classifyPersistence(options: ClassifyPersistenceOptions): PerfPersistenceProbe {
  return {
    ...options,
    offThreadSerializationThresholdMs: OFF_THREAD_SERIALIZATION_THRESHOLD_MS,
    indexedDbThresholdBytes: INDEXED_DB_THRESHOLD_BYTES,
    recommendOffThreadSerialization:
      options.parseMs > OFF_THREAD_SERIALIZATION_THRESHOLD_MS ||
      options.serializationMs > OFF_THREAD_SERIALIZATION_THRESHOLD_MS,
    recommendIndexedDb:
      options.serializedBytes > INDEXED_DB_THRESHOLD_BYTES ||
      options.localStorageWriteOutcome !== 'stored',
  };
}
