import type { PerfProductionPersistenceProbe } from '../../src/perf/types';

interface ProductionPersistencePair {
  cold: PerfProductionPersistenceProbe | null;
  warm: PerfProductionPersistenceProbe | null;
}

/** Preserve the slower observed production lane when both journeys saved. */
export function combineProductionPersistence({
  cold,
  warm,
}: ProductionPersistencePair): PerfProductionPersistenceProbe | undefined {
  if (!cold || !warm) return cold ?? warm ?? undefined;
  return {
    saveMs: Math.max(cold.saveMs, warm.saveMs),
    serializationMs: Math.max(cold.serializationMs, warm.serializationMs),
    indexedDbWriteMs: Math.max(cold.indexedDbWriteMs, warm.indexedDbWriteMs),
  };
}
