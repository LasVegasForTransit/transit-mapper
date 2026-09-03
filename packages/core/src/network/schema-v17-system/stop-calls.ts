import type { Pattern, TransitSystem } from '../../transit/authored-system';
import type { ResolvedPatternStopCall } from '../resolved-network-chunk';

/**
 * Schedule evidence for one stop call, keyed by the call it belongs to.
 *
 * A Trip records stop times against `stopCallId`, so evidence is gathered per
 * call rather than per stop: one Stop can be called at twice in a loop, and
 * the two calls can board differently.
 */
function boardingByStopCall(
  system: TransitSystem,
  patternId: string,
): ReadonlyMap<string, { boards: boolean; scheduled: boolean }> {
  const byCall = new Map<string, { boards: boolean; scheduled: boolean }>();
  for (const trip of system.trips) {
    if (trip.patternId !== patternId) continue;
    for (const stopTime of trip.stopTimes) {
      const boards = stopTime.pickup !== 'none' || stopTime.dropOff !== 'none';
      const existing = byCall.get(stopTime.stopCallId);
      byCall.set(stopTime.stopCallId, {
        boards: (existing?.boards ?? false) || boards,
        scheduled: true,
      });
    }
  }
  return byCall;
}

/** No Trip mentions this call, so the document states nothing about whether a
 * vehicle stops. That is `unknown` rather than `skipped`: a Pattern can be
 * authored before any Trip exists, and reporting it as skipped would claim
 * evidence the document does not carry. */
function serviceFor(
  evidence: { boards: boolean; scheduled: boolean } | undefined,
): ResolvedPatternStopCall['service'] {
  if (!evidence?.scheduled) return 'unknown';
  return evidence.boards ? 'served' : 'skipped';
}

/**
 * Projects one Pattern's stop calls in authored order.
 *
 * `pathAnchor` is deliberately absent. Anchoring a call to a leg and a carrier
 * position means projecting the stop onto the path, which is its own piece of
 * work; the field is optional precisely so a provider can report calls before
 * it can place them.
 */
export function projectPatternStopCalls(
  pattern: Pattern,
  system: TransitSystem,
): readonly ResolvedPatternStopCall[] {
  const evidence = boardingByStopCall(system, pattern.id);
  return pattern.stopCalls.map((call, sequence) => ({
    id: call.id,
    patternId: pattern.id,
    stopId: call.stopId,
    sequence,
    service: serviceFor(evidence.get(call.id)),
  }));
}
