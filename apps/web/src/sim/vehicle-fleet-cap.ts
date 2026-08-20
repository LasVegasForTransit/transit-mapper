const clampedFleetsReported = new Set<string>();

/** Reports a rendering cap once without changing the service plan. */
export function noteClampedFleet(
  patternId: string,
  serviceName: string,
  fleet: number,
  shown: number,
): void {
  if (!import.meta.env.DEV || clampedFleetsReported.has(patternId)) return;
  clampedFleetsReported.add(patternId);
  console.info(
    `[sim] ${serviceName}: running ${fleet} vehicles, drawing ${shown}. Headway and spacing are unaffected; the map shows gaps.`,
  );
}
