import type {
  FrequencyRule,
  Pattern,
  ScheduledStopTime,
  Schedule,
  ServicePlan,
  TransitSystem,
  Trip,
} from '../../transit/authored-system';

interface IdentifiedRecord {
  readonly id: string;
}

function indexById<Record extends IdentifiedRecord>(
  label: string,
  records: readonly Record[],
): ReadonlyMap<string, Record> {
  const indexed = new Map<string, Record>();
  for (const record of records) {
    if (indexed.has(record.id)) throw new Error(`Duplicate ${label} ID: ${record.id}.`);
    indexed.set(record.id, record);
  }
  return indexed;
}

interface RelationshipOwnersOptions<Owner extends IdentifiedRecord> {
  readonly ownerLabel: string;
  readonly owners: readonly Owner[];
  readonly memberIds: (owner: Owner) => readonly string[];
  readonly targetLabel: string;
  readonly targets: ReadonlyMap<string, IdentifiedRecord>;
}

function relationshipOwners<Owner extends IdentifiedRecord>({
  ownerLabel,
  owners,
  memberIds,
  targetLabel,
  targets,
}: RelationshipOwnersOptions<Owner>): ReadonlyMap<string, ReadonlySet<string>> {
  const ownersByTarget = new Map<string, Set<string>>();
  for (const owner of owners) {
    const seen = new Set<string>();
    for (const targetId of memberIds(owner)) {
      if (seen.has(targetId)) {
        throw new Error(`${ownerLabel} ${owner.id} repeats ${targetLabel} ${targetId}.`);
      }
      seen.add(targetId);
      if (!targets.has(targetId)) {
        throw new Error(`${ownerLabel} ${owner.id} references missing ${targetLabel} ${targetId}.`);
      }
      const targetOwners = ownersByTarget.get(targetId) ?? new Set<string>();
      targetOwners.add(owner.id);
      ownersByTarget.set(targetId, targetOwners);
    }
  }
  return ownersByTarget;
}

interface RequireOwnersOptions {
  readonly targetLabel: string;
  readonly targetId: string;
  readonly ownerLabel: string;
  readonly ownersByTarget: ReadonlyMap<string, ReadonlySet<string>>;
  readonly exactlyOne?: boolean;
}

function requireOwners({
  targetLabel,
  targetId,
  ownerLabel,
  ownersByTarget,
  exactlyOne = false,
}: RequireOwnersOptions): ReadonlySet<string> {
  const owners = ownersByTarget.get(targetId) ?? new Set<string>();
  if (owners.size === 0) {
    throw new Error(`${targetLabel} ${targetId} has no ${ownerLabel} owner.`);
  }
  if (exactlyOne && owners.size !== 1) {
    throw new Error(`${targetLabel} ${targetId} has ${owners.size} ${ownerLabel} owners.`);
  }
  return owners;
}

function stopCallIdsByPattern(
  patterns: readonly Pattern[],
  stops: ReadonlyMap<string, IdentifiedRecord>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const idsByPattern = new Map<string, Set<string>>();
  for (const pattern of patterns) {
    const ids = new Set<string>();
    for (const call of pattern.stopCalls) {
      if (ids.has(call.id)) throw new Error(`Pattern ${pattern.id} repeats stop call ${call.id}.`);
      if (!stops.has(call.stopId)) {
        throw new Error(`Pattern ${pattern.id} references missing Stop ${call.stopId}.`);
      }
      ids.add(call.id);
    }
    idsByPattern.set(pattern.id, ids);
  }
  return idsByPattern;
}

function hasIntersection(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

interface ValidateTimingRecordOptions {
  readonly label: 'Trip' | 'FrequencyRule';
  readonly id: string;
  readonly patternId: string;
  readonly calendarId: string;
  readonly stopTimes: readonly ScheduledStopTime[];
  readonly patterns: ReadonlyMap<string, IdentifiedRecord>;
  readonly calendars: ReadonlyMap<string, IdentifiedRecord>;
  readonly scheduleOwners: ReadonlySet<string>;
  readonly servicePlanIdsBySchedule: ReadonlyMap<string, ReadonlySet<string>>;
  readonly servicePlanIdsByPattern: ReadonlyMap<string, ReadonlySet<string>>;
  readonly stopCallIds: ReadonlyMap<string, ReadonlySet<string>>;
}

function validateTimingRecord(options: ValidateTimingRecordOptions): void {
  if (!options.patterns.has(options.patternId)) {
    throw new Error(
      `${options.label} ${options.id} references missing Pattern ${options.patternId}.`,
    );
  }
  if (!options.calendars.has(options.calendarId)) {
    throw new Error(
      `${options.label} ${options.id} references missing Calendar ${options.calendarId}.`,
    );
  }
  const patternOwners = options.servicePlanIdsByPattern.get(options.patternId) ?? new Set<string>();
  for (const scheduleId of options.scheduleOwners) {
    const scheduleOwners = options.servicePlanIdsBySchedule.get(scheduleId) ?? new Set<string>();
    if (!hasIntersection(patternOwners, scheduleOwners)) {
      throw new Error(
        `${options.label} ${options.id} joins Pattern ${options.patternId} to incompatible Schedule ${scheduleId}.`,
      );
    }
  }
  const validStopCallIds = options.stopCallIds.get(options.patternId) ?? new Set<string>();
  const seenStopCallIds = new Set<string>();
  for (const stopTime of options.stopTimes) {
    if (seenStopCallIds.has(stopTime.stopCallId)) {
      throw new Error(`${options.label} ${options.id} repeats stop call ${stopTime.stopCallId}.`);
    }
    if (!validStopCallIds.has(stopTime.stopCallId)) {
      throw new Error(
        `${options.label} ${options.id} references missing stop call ${stopTime.stopCallId} on Pattern ${options.patternId}.`,
      );
    }
    seenStopCallIds.add(stopTime.stopCallId);
  }
}

interface PassengerRelationshipContext {
  readonly servicePlans: ReadonlyMap<string, ServicePlan>;
  readonly patterns: ReadonlyMap<string, Pattern>;
  readonly schedules: ReadonlyMap<string, Schedule>;
  readonly calendars: ReadonlyMap<string, IdentifiedRecord>;
  readonly trips: ReadonlyMap<string, Trip>;
  readonly frequencyRules: ReadonlyMap<string, FrequencyRule>;
  readonly lineIdsByServicePlan: ReadonlyMap<string, ReadonlySet<string>>;
  readonly servicePlanIdsByPattern: ReadonlyMap<string, ReadonlySet<string>>;
  readonly servicePlanIdsBySchedule: ReadonlyMap<string, ReadonlySet<string>>;
  readonly scheduleIdsByTrip: ReadonlyMap<string, ReadonlySet<string>>;
  readonly scheduleIdsByFrequencyRule: ReadonlyMap<string, ReadonlySet<string>>;
  readonly stopCallIds: ReadonlyMap<string, ReadonlySet<string>>;
}

function passengerRelationshipContext(system: TransitSystem): PassengerRelationshipContext {
  indexById('Line', system.lines);
  const servicePlans = indexById('ServicePlan', system.servicePlans);
  const patterns = indexById('Pattern', system.patterns);
  const schedules = indexById('Schedule', system.schedules);
  const calendars = indexById('Calendar', system.calendars);
  const trips = indexById('Trip', system.trips);
  const frequencyRules = indexById('FrequencyRule', system.frequencyRules);
  const stops = indexById('Stop', system.stops);
  return {
    servicePlans,
    patterns,
    schedules,
    calendars,
    trips,
    frequencyRules,
    lineIdsByServicePlan: relationshipOwners({
      ownerLabel: 'Line',
      owners: system.lines,
      memberIds: (line) => line.servicePlanIds,
      targetLabel: 'ServicePlan',
      targets: servicePlans,
    }),
    servicePlanIdsByPattern: relationshipOwners({
      ownerLabel: 'ServicePlan',
      owners: system.servicePlans,
      memberIds: (plan) => plan.patternIds,
      targetLabel: 'Pattern',
      targets: patterns,
    }),
    servicePlanIdsBySchedule: relationshipOwners({
      ownerLabel: 'ServicePlan',
      owners: system.servicePlans,
      memberIds: (plan) => plan.scheduleIds,
      targetLabel: 'Schedule',
      targets: schedules,
    }),
    scheduleIdsByTrip: relationshipOwners({
      ownerLabel: 'Schedule',
      owners: system.schedules,
      memberIds: (schedule) => schedule.tripIds,
      targetLabel: 'Trip',
      targets: trips,
    }),
    scheduleIdsByFrequencyRule: relationshipOwners({
      ownerLabel: 'Schedule',
      owners: system.schedules,
      memberIds: (schedule) => schedule.frequencyRuleIds,
      targetLabel: 'FrequencyRule',
      targets: frequencyRules,
    }),
    stopCallIds: stopCallIdsByPattern(system.patterns, stops),
  };
}

function validatePassengerOwners(context: PassengerRelationshipContext): void {
  const {
    servicePlans,
    patterns,
    schedules,
    lineIdsByServicePlan,
    servicePlanIdsByPattern,
    servicePlanIdsBySchedule,
  } = context;
  for (const servicePlan of servicePlans.values()) {
    requireOwners({
      targetLabel: 'ServicePlan',
      targetId: servicePlan.id,
      ownerLabel: 'Line',
      ownersByTarget: lineIdsByServicePlan,
      exactlyOne: true,
    });
  }
  for (const pattern of patterns.values()) {
    const planIds = requireOwners({
      targetLabel: 'Pattern',
      targetId: pattern.id,
      ownerLabel: 'ServicePlan',
      ownersByTarget: servicePlanIdsByPattern,
    });
    const lineIds = new Set(
      [...planIds].flatMap((planId) => [...(lineIdsByServicePlan.get(planId) ?? [])]),
    );
    if (lineIds.size !== 1) throw new Error(`Pattern ${pattern.id} belongs to distinct Lines.`);
  }
  for (const schedule of schedules.values()) {
    requireOwners({
      targetLabel: 'Schedule',
      targetId: schedule.id,
      ownerLabel: 'ServicePlan',
      ownersByTarget: servicePlanIdsBySchedule,
    });
  }
}

function validatePassengerTiming(context: PassengerRelationshipContext): void {
  const {
    patterns,
    calendars,
    trips,
    frequencyRules,
    servicePlanIdsByPattern,
    servicePlanIdsBySchedule,
    scheduleIdsByTrip,
    scheduleIdsByFrequencyRule,
    stopCallIds,
  } = context;
  for (const trip of trips.values()) {
    const scheduleOwners = requireOwners({
      targetLabel: 'Trip',
      targetId: trip.id,
      ownerLabel: 'Schedule',
      ownersByTarget: scheduleIdsByTrip,
    });
    validateTimingRecord({
      label: 'Trip',
      ...trip,
      patterns,
      calendars,
      scheduleOwners,
      servicePlanIdsBySchedule,
      servicePlanIdsByPattern,
      stopCallIds,
    });
  }
  for (const rule of frequencyRules.values()) {
    const scheduleOwners = requireOwners({
      targetLabel: 'FrequencyRule',
      targetId: rule.id,
      ownerLabel: 'Schedule',
      ownersByTarget: scheduleIdsByFrequencyRule,
    });
    validateTimingRecord({
      label: 'FrequencyRule',
      id: rule.id,
      patternId: rule.patternId,
      calendarId: rule.calendarId,
      stopTimes: rule.templateStopTimes,
      patterns,
      calendars,
      scheduleOwners,
      servicePlanIdsBySchedule,
      servicePlanIdsByPattern,
      stopCallIds,
    });
  }
}

/** Validates the stored ownership graph beneath passenger Lines. It accepts
 * typed authored values and performs no parsing or provider reconciliation. */
export function validateAuthoredPassengerRelationships(system: TransitSystem): void {
  const context = passengerRelationshipContext(system);
  validatePassengerOwners(context);
  validatePassengerTiming(context);
}
