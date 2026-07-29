export interface EventTimingSample {
  name: string;
  interactionId: number;
  duration: number;
  startTime: number;
}

/**
 * Event Timing assigns one positive ID to every entry that belongs to the
 * same physical interaction. Entries with ID zero are not interactions and
 * must not contribute synthetic input-latency samples.
 */
export function eventTimingInteractionDurations(entries: readonly EventTimingSample[]): number[] {
  const interactions = new Map<number, number>();
  for (const entry of entries) {
    if (entry.interactionId <= 0) continue;
    interactions.set(
      entry.interactionId,
      Math.max(interactions.get(entry.interactionId) ?? 0, entry.duration),
    );
  }
  return [...interactions.values()];
}
