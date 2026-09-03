import type {
  Calendar,
  CalendarException,
  FrequencyRule,
  Line,
  Pattern,
  PatternLeg,
  PatternPath,
  PatternStopCall,
  Schedule,
  ScheduledStopTime,
  ServicePlan,
  ServicePlanningSummary,
  Trip,
} from '../../transit/authored-system';
import type {
  PatternDirection,
  ServiceDateRange,
  ServiceTimeZone,
  Weekday,
} from '../../transit/value-types';
import {
  exactRecord,
  parseArray,
  parseEnum,
  parseFiniteNumber,
  parseNonnegativeInteger,
  parsePositiveInteger,
  parseServiceDate,
  parseText,
  parseUniqueTextArray,
} from './parse-values';

const LEG_DIRECTIONS = ['forward', 'reverse'] as const;
const PRECISIONS = ['exact', 'estimated', 'unknown'] as const;
const FREQUENCY_PRECISIONS = ['exact', 'headway', 'unknown'] as const;
const BOARDING_RULES = ['regular', 'none', 'request', 'coordinate', 'unknown'] as const;
const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

function parseExtent(value: unknown, label: string): PatternLeg['extent'] {
  const record = exactRecord(value, label, ['start', 'end']);
  const start = parseFiniteNumber(record.start, `${label} start`);
  const end = parseFiniteNumber(record.end, `${label} end`);
  if (start < 0 || start > 1 || end < 0 || end > 1 || start === end) {
    throw new Error(`${label} extent must have two distinct positions from zero through one.`);
  }
  return { start, end };
}

function parsePatternLeg(value: unknown, label: string): PatternLeg {
  const base = exactRecord(
    value,
    label,
    ['kind', 'direction', 'extent'],
    ['alignmentId', 'wayId', 'lane'],
  );
  const direction = parseEnum(base.direction, `${label} direction`, LEG_DIRECTIONS);
  const extent = parseExtent(base.extent, `${label} extent`);
  if (base.kind === 'alignment') {
    const record = exactRecord(value, label, ['kind', 'alignmentId', 'direction', 'extent']);
    return {
      kind: 'alignment',
      alignmentId: parseText(record.alignmentId, `${label} Alignment ID`),
      direction,
      extent,
    };
  }
  if (base.kind !== 'way') throw new Error(`${label} kind is invalid.`);
  const record = exactRecord(value, label, ['kind', 'wayId', 'lane', 'direction', 'extent']);
  const lane = exactRecord(record.lane, `${label} lane`, ['kind'], ['laneId']);
  if (lane.kind === 'auto') {
    exactRecord(record.lane, `${label} lane`, ['kind']);
    return {
      kind: 'way',
      wayId: parseText(record.wayId, `${label} Way ID`),
      lane: { kind: 'auto' },
      direction,
      extent,
    };
  }
  if (lane.kind !== 'pinned') throw new Error(`${label} lane kind is invalid.`);
  const pinned = exactRecord(record.lane, `${label} lane`, ['kind', 'laneId']);
  return {
    kind: 'way',
    wayId: parseText(record.wayId, `${label} Way ID`),
    lane: { kind: 'pinned', laneId: parseText(pinned.laneId, `${label} lane ID`) },
    direction,
    extent,
  };
}

function parsePatternPath(value: unknown, label: string): PatternPath {
  const base = exactRecord(value, label, ['kind'], ['legs']);
  if (base.kind === 'unknown') {
    exactRecord(value, label, ['kind']);
    return { kind: 'unknown' };
  }
  if (base.kind !== 'known') throw new Error(`${label} kind is invalid.`);
  const record = exactRecord(value, label, ['kind', 'legs']);
  const legs = parseArray(record.legs, `${label} legs`, parsePatternLeg);
  if (legs.length === 0) throw new Error(`${label} has an empty path.`);
  return { kind: 'known', legs };
}

function parsePatternDirection(value: unknown, label: string): PatternDirection {
  const record = exactRecord(value, label, ['key'], ['label']);
  const direction: PatternDirection = { key: parseText(record.key, `${label} key`) };
  if ('label' in record) direction.label = parseText(record.label, `${label} label`);
  return direction;
}

function parseStopCall(value: unknown, label: string): PatternStopCall {
  const record = exactRecord(value, label, ['id', 'stopId']);
  return {
    id: parseText(record.id, `${label} ID`),
    stopId: parseText(record.stopId, `${label} Stop ID`),
  };
}

export function parseLine(value: unknown, label: string): Line {
  const record = exactRecord(value, label, ['id', 'name', 'color', 'servicePlanIds']);
  return {
    id: parseText(record.id, `${label} ID`),
    name: parseText(record.name, `${label} name`),
    color: parseText(record.color, `${label} color`),
    servicePlanIds: parseUniqueTextArray(record.servicePlanIds, `${label} ServicePlan IDs`),
  };
}

function parsePlanningSummary(value: unknown, label: string): ServicePlanningSummary {
  const record = exactRecord(
    value,
    label,
    [],
    ['peakHeadwaySeconds', 'spanStartSeconds', 'spanEndSeconds'],
  );
  const summary: ServicePlanningSummary = {};
  if ('peakHeadwaySeconds' in record) {
    summary.peakHeadwaySeconds = parsePositiveInteger(
      record.peakHeadwaySeconds,
      `${label} peak headway`,
    );
  }
  if ('spanStartSeconds' in record) {
    summary.spanStartSeconds = parseNonnegativeInteger(
      record.spanStartSeconds,
      `${label} span start`,
    );
  }
  if ('spanEndSeconds' in record) {
    summary.spanEndSeconds = parseNonnegativeInteger(record.spanEndSeconds, `${label} span end`);
  }
  if (
    summary.spanStartSeconds !== undefined &&
    summary.spanStartSeconds === summary.spanEndSeconds
  ) {
    throw new Error(`${label} span must not have equal endpoints.`);
  }
  return summary;
}

export function parseServicePlan(value: unknown, label: string): ServicePlan {
  const record = exactRecord(
    value,
    label,
    ['id', 'modeId', 'patternIds', 'scheduleIds'],
    ['name', 'vehicleKindId', 'planningSummary'],
  );
  const plan: ServicePlan = {
    id: parseText(record.id, `${label} ID`),
    modeId: parseText(record.modeId, `${label} mode ID`),
    patternIds: parseUniqueTextArray(record.patternIds, `${label} Pattern IDs`),
    scheduleIds: parseUniqueTextArray(record.scheduleIds, `${label} Schedule IDs`),
  };
  if ('name' in record) plan.name = parseText(record.name, `${label} name`);
  if ('vehicleKindId' in record) {
    plan.vehicleKindId = parseText(record.vehicleKindId, `${label} VehicleKind ID`);
  }
  if ('planningSummary' in record) {
    plan.planningSummary = parsePlanningSummary(
      record.planningSummary,
      `${label} planning summary`,
    );
  }
  return plan;
}

export function parsePattern(value: unknown, label: string): Pattern {
  const record = exactRecord(value, label, ['id', 'path', 'stopCalls'], ['direction']);
  const pattern: Pattern = {
    id: parseText(record.id, `${label} ID`),
    path: parsePatternPath(record.path, `${label} path`),
    stopCalls: parseArray(record.stopCalls, `${label} stop calls`, parseStopCall),
  };
  if ('direction' in record) {
    pattern.direction = parsePatternDirection(record.direction, `${label} direction`);
  }
  return pattern;
}

export function parseSchedule(value: unknown, label: string): Schedule {
  const record = exactRecord(value, label, ['id', 'tripIds', 'frequencyRuleIds']);
  return {
    id: parseText(record.id, `${label} ID`),
    tripIds: parseUniqueTextArray(record.tripIds, `${label} Trip IDs`),
    frequencyRuleIds: parseUniqueTextArray(record.frequencyRuleIds, `${label} FrequencyRule IDs`),
  };
}

function parseScheduledStopTime(value: unknown, label: string): ScheduledStopTime {
  const record = exactRecord(
    value,
    label,
    ['stopCallId', 'precision', 'pickup', 'dropOff'],
    ['arrivalSeconds', 'departureSeconds'],
  );
  const stopTime: ScheduledStopTime = {
    stopCallId: parseText(record.stopCallId, `${label} StopCall ID`),
    precision: parseEnum(record.precision, `${label} precision`, PRECISIONS),
    pickup: parseEnum(record.pickup, `${label} pickup rule`, BOARDING_RULES),
    dropOff: parseEnum(record.dropOff, `${label} drop-off rule`, BOARDING_RULES),
  };
  if ('arrivalSeconds' in record) {
    stopTime.arrivalSeconds = parseNonnegativeInteger(
      record.arrivalSeconds,
      `${label} arrival time`,
    );
  }
  if ('departureSeconds' in record) {
    stopTime.departureSeconds = parseNonnegativeInteger(
      record.departureSeconds,
      `${label} departure time`,
    );
  }
  return stopTime;
}

export function parseTrip(value: unknown, label: string): Trip {
  const record = exactRecord(value, label, ['id', 'patternId', 'calendarId', 'stopTimes']);
  return {
    id: parseText(record.id, `${label} ID`),
    patternId: parseText(record.patternId, `${label} Pattern ID`),
    calendarId: parseText(record.calendarId, `${label} Calendar ID`),
    stopTimes: parseArray(record.stopTimes, `${label} stop times`, parseScheduledStopTime),
  };
}

export function parseFrequencyRule(value: unknown, label: string): FrequencyRule {
  const record = exactRecord(
    value,
    label,
    [
      'id',
      'patternId',
      'calendarId',
      'startTimeSeconds',
      'endTimeSeconds',
      'headwaySeconds',
      'precision',
      'templateStopTimes',
    ],
    ['label'],
  );
  const startTimeSeconds = parseNonnegativeInteger(record.startTimeSeconds, `${label} start time`);
  const endTimeSeconds = parseNonnegativeInteger(record.endTimeSeconds, `${label} end time`);
  if (startTimeSeconds === endTimeSeconds) {
    throw new Error(`${label} operating window must not have equal endpoints.`);
  }
  const rule: FrequencyRule = {
    id: parseText(record.id, `${label} ID`),
    patternId: parseText(record.patternId, `${label} Pattern ID`),
    calendarId: parseText(record.calendarId, `${label} Calendar ID`),
    startTimeSeconds,
    endTimeSeconds,
    headwaySeconds: parsePositiveInteger(record.headwaySeconds, `${label} headway`),
    precision: parseEnum(record.precision, `${label} precision`, FREQUENCY_PRECISIONS),
    templateStopTimes: parseArray(
      record.templateStopTimes,
      `${label} template stop times`,
      parseScheduledStopTime,
    ),
  };
  if ('label' in record) rule.label = parseText(record.label, `${label} label`);
  return rule;
}

function parseTimeZone(value: unknown, label: string): ServiceTimeZone {
  const base = exactRecord(value, label, ['kind'], ['value']);
  if (base.kind === 'unknown') {
    exactRecord(value, label, ['kind']);
    return { kind: 'unknown' };
  }
  if (base.kind !== 'iana') throw new Error(`${label} kind is invalid.`);
  const record = exactRecord(value, label, ['kind', 'value']);
  const timeZone = parseText(record.value, `${label} value`);
  try {
    new Intl.DateTimeFormat('en', { timeZone });
  } catch {
    throw new Error(`${label} must name a known IANA time zone.`);
  }
  return { kind: 'iana', value: timeZone };
}

function parseDateRange(value: unknown, label: string): ServiceDateRange {
  const base = exactRecord(value, label, ['kind'], ['startDate', 'endDate']);
  if (base.kind === 'unbounded') {
    exactRecord(value, label, ['kind']);
    return { kind: 'unbounded' };
  }
  if (base.kind === 'from') {
    const record = exactRecord(value, label, ['kind', 'startDate']);
    return { kind: 'from', startDate: parseServiceDate(record.startDate, `${label} start`) };
  }
  if (base.kind === 'through') {
    const record = exactRecord(value, label, ['kind', 'endDate']);
    return { kind: 'through', endDate: parseServiceDate(record.endDate, `${label} end`) };
  }
  if (base.kind !== 'bounded') throw new Error(`${label} kind is invalid.`);
  const record = exactRecord(value, label, ['kind', 'startDate', 'endDate']);
  const startDate = parseServiceDate(record.startDate, `${label} start`);
  const endDate = parseServiceDate(record.endDate, `${label} end`);
  if (startDate > endDate) throw new Error(`${label} starts after it ends.`);
  return { kind: 'bounded', startDate, endDate };
}

function parseCalendarException(value: unknown, label: string): CalendarException {
  const record = exactRecord(value, label, ['serviceDate', 'action']);
  return {
    serviceDate: parseServiceDate(record.serviceDate, `${label} service date`),
    action: parseEnum(record.action, `${label} action`, ['add', 'remove'] as const),
  };
}

export function parseCalendar(value: unknown, label: string): Calendar {
  const record = exactRecord(value, label, [
    'id',
    'timeZone',
    'dateRange',
    'activeWeekdays',
    'exceptions',
  ]);
  const activeWeekdays = parseArray(
    record.activeWeekdays,
    `${label} active weekdays`,
    (item, itemLabel) => parseEnum(item, itemLabel, WEEKDAYS),
  ) as Weekday[];
  if (new Set(activeWeekdays).size !== activeWeekdays.length) {
    throw new Error(`${label} active weekdays contain duplicates.`);
  }
  return {
    id: parseText(record.id, `${label} ID`),
    timeZone: parseTimeZone(record.timeZone, `${label} time zone`),
    dateRange: parseDateRange(record.dateRange, `${label} date range`),
    activeWeekdays,
    exceptions: parseArray(record.exceptions, `${label} exceptions`, parseCalendarException),
  };
}
