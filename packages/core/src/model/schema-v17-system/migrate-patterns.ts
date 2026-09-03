import { patternRunLegs } from '../geo/servicePaths';
import type {
  PatternLeg as SchemaV16PatternLeg,
  RunDirection,
  Service,
  TransitSystem,
} from '../system';
import type { Pattern, PatternLeg, PatternStopCall } from '../../transit/authored-system';
import { legacyDerivedId } from '../schema-v16-system/legacy-id';

export interface MigratedServicePatterns {
  ids: { outbound: string; inbound?: string };
  patterns: Pattern[];
}

export function migrateServicePatterns(
  service: Service,
  stops: TransitSystem['stops'],
): MigratedServicePatterns {
  const outboundId = legacyDerivedId('pattern', service.id, 'outbound');
  const outboundLegs = patternRunLegs(service.path, 'outbound');
  const patterns = [
    migrateRunPattern({
      id: outboundId,
      service,
      run: 'outbound',
      runLegs: outboundLegs,
      stops,
    }),
  ];
  const inboundLegs = patternRunLegs(service.path, 'inbound');
  if (inboundLegs.length === 0) return { ids: { outbound: outboundId }, patterns };

  const inboundId = legacyDerivedId('pattern', service.id, 'inbound');
  patterns.push(
    migrateRunPattern({
      id: inboundId,
      service,
      run: 'inbound',
      runLegs: inboundLegs,
      stops,
    }),
  );
  return { ids: { outbound: outboundId, inbound: inboundId }, patterns };
}

interface RunPatternMigrationInput {
  id: string;
  service: Service;
  run: RunDirection;
  runLegs: ReturnType<typeof patternRunLegs>;
  stops: TransitSystem['stops'];
}

function migrateRunPattern({
  id,
  service,
  run,
  runLegs,
  stops,
}: RunPatternMigrationInput): Pattern {
  return {
    id,
    direction: { key: run },
    path:
      runLegs.length === 0
        ? { kind: 'unknown' }
        : { kind: 'known', legs: runLegs.map(migratePatternLeg) },
    stopCalls: migrateStopCalls(service, run, runLegs, stops),
  };
}

interface StopCallCandidate {
  stopId: string;
  position: number;
  stopIndex: number;
  anchorIndex: number;
  atTravelStart: boolean;
  atTravelEnd: boolean;
}

function migrateStopCalls(
  service: Service,
  run: RunDirection,
  runLegs: ReturnType<typeof patternRunLegs>,
  stops: TransitSystem['stops'],
): PatternStopCall[] {
  const skippedStopIds = new Set(service.path.skippedStops?.[run] ?? []);
  const calls: PatternStopCall[] = [];
  let previousLegEndStopIds = new Set<string>();

  for (const runLeg of runLegs) {
    const candidates = stopCandidatesForRunLeg(runLeg, stops, skippedStopIds);
    for (const candidate of candidates) {
      if (candidate.atTravelStart && previousLegEndStopIds.has(candidate.stopId)) continue;
      calls.push({
        id: legacyDerivedId('stop-call', service.id, run, calls.length, candidate.stopId),
        stopId: candidate.stopId,
      });
    }
    previousLegEndStopIds = new Set(
      candidates.filter((candidate) => candidate.atTravelEnd).map((candidate) => candidate.stopId),
    );
  }

  return calls;
}

function stopCandidatesForRunLeg(
  runLeg: ReturnType<typeof patternRunLegs>[number],
  stops: TransitSystem['stops'],
  skippedStopIds: ReadonlySet<string>,
): StopCallCandidate[] {
  const candidates: StopCallCandidate[] = [];
  for (const [stopIndex, stop] of stops.entries()) {
    if (skippedStopIds.has(stop.id)) continue;
    const candidate = stopCandidateForRunLeg(runLeg, stop, stopIndex);
    if (candidate) candidates.push(candidate);
  }
  return candidates.sort(
    (left, right) =>
      left.position - right.position ||
      left.stopIndex - right.stopIndex ||
      left.anchorIndex - right.anchorIndex,
  );
}

function stopCandidateForRunLeg(
  runLeg: ReturnType<typeof patternRunLegs>[number],
  stop: TransitSystem['stops'][number],
  stopIndex: number,
): StopCallCandidate | undefined {
  const [lower, upper] = legacyLegBounds(runLeg.leg);
  let selected: StopCallCandidate | undefined;
  for (const [anchorIndex, anchor] of stop.anchors.entries()) {
    if (anchor.wayId !== runLeg.leg.wayId || anchor.t < lower || anchor.t > upper) continue;
    const travelStart = runLeg.forward ? lower : upper;
    const travelEnd = runLeg.forward ? upper : lower;
    const candidate: StopCallCandidate = {
      stopId: stop.id,
      position: runLeg.forward ? anchor.t : -anchor.t,
      stopIndex,
      anchorIndex,
      atTravelStart: anchor.t === travelStart,
      atTravelEnd: anchor.t === travelEnd,
    };
    if (
      selected === undefined ||
      candidate.position < selected.position ||
      (candidate.position === selected.position && candidate.anchorIndex < selected.anchorIndex)
    ) {
      selected = candidate;
    }
  }
  return selected;
}

function legacyLegBounds(leg: SchemaV16PatternLeg): [number, number] {
  if (leg.extent.kind === 'whole') return [0, 1];
  return leg.extent.fromT <= leg.extent.toT
    ? [leg.extent.fromT, leg.extent.toT]
    : [leg.extent.toT, leg.extent.fromT];
}

function migratePatternLeg(runLeg: ReturnType<typeof patternRunLegs>[number]): PatternLeg {
  const { leg, forward } = runLeg;
  return {
    kind: 'way',
    wayId: leg.wayId,
    lane: leg.lane.kind === 'auto' ? { kind: 'auto' } : { kind: 'pinned', laneId: leg.lane.laneId },
    direction: forward ? 'forward' : 'reverse',
    extent:
      leg.extent.kind === 'whole'
        ? { start: 0, end: 1 }
        : { start: leg.extent.fromT, end: leg.extent.toT },
  };
}
