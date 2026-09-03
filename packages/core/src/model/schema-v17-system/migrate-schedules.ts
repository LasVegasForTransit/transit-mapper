import type { RunDirection, Service } from '../system';
import type {
  Calendar,
  FrequencyRule,
  Schedule,
  ServicePlanningSummary,
} from '../../transit/authored-system';
import { parseHhMm } from '../../transit/service-time';
import { legacyDerivedId } from '../schema-v16-system/legacy-id';

export interface MigratedServiceTiming {
  scheduleIds: string[];
  schedules: Schedule[];
  calendars: Calendar[];
  frequencyRules: FrequencyRule[];
  planningSummary?: ServicePlanningSummary;
}

export function migrateServiceTiming(
  service: Service,
  patternIds: { outbound: string; inbound?: string },
): MigratedServiceTiming {
  const planningSummary = migratePlanningSummary(service);
  const periods = service.schedule ?? [];
  if (periods.length === 0) {
    return { scheduleIds: [], schedules: [], calendars: [], frequencyRules: [], planningSummary };
  }

  const scheduleId = legacyDerivedId('schedule', service.id);
  const calendars: Calendar[] = [];
  const frequencyRules: FrequencyRule[] = [];
  for (const [periodIndex, period] of periods.entries()) {
    for (const [run, patternId] of runPatternIds(patternIds)) {
      const calendarId = legacyDerivedId('calendar', service.id, periodIndex, period.id, run);
      const frequencyRuleId = legacyDerivedId(
        'frequency-rule',
        service.id,
        periodIndex,
        period.id,
        run,
      );
      calendars.push({
        id: calendarId,
        timeZone: { kind: 'unknown' },
        dateRange: { kind: 'unbounded' },
        activeWeekdays: weekdaysFor(period.days),
        exceptions: [],
      });
      frequencyRules.push({
        id: frequencyRuleId,
        label: period.label,
        patternId,
        calendarId,
        startTimeSeconds: serviceTimeSeconds(period.spanStart),
        endTimeSeconds: spanEndSeconds(period.spanStart, period.spanEnd),
        headwaySeconds: headwaySeconds(period.frequencyMinutes),
        precision: 'headway',
        templateStopTimes: [],
      });
    }
  }

  return {
    scheduleIds: [scheduleId],
    schedules: [
      { id: scheduleId, tripIds: [], frequencyRuleIds: frequencyRules.map((rule) => rule.id) },
    ],
    calendars,
    frequencyRules,
    planningSummary,
  };
}

function migratePlanningSummary(service: Service): ServicePlanningSummary | undefined {
  const summary: ServicePlanningSummary = {};
  if (service.frequencyMinutes !== undefined) {
    summary.peakHeadwaySeconds = headwaySeconds(service.frequencyMinutes);
  }
  if (service.spanStart !== undefined)
    summary.spanStartSeconds = serviceTimeSeconds(service.spanStart);
  if (service.spanEnd !== undefined) {
    summary.spanEndSeconds =
      service.spanStart === undefined
        ? serviceTimeSeconds(service.spanEnd)
        : spanEndSeconds(service.spanStart, service.spanEnd);
  }
  return Object.keys(summary).length === 0 ? undefined : summary;
}

function runPatternIds(ids: { outbound: string; inbound?: string }): [RunDirection, string][] {
  return ids.inbound === undefined
    ? [['outbound', ids.outbound]]
    : [
        ['outbound', ids.outbound],
        ['inbound', ids.inbound],
      ];
}

function weekdaysFor(days: 'daily' | 'weekday' | 'weekend'): Calendar['activeWeekdays'] {
  if (days === 'daily') {
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  }
  return days === 'weekday'
    ? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
    : ['saturday', 'sunday'];
}

function serviceTimeSeconds(value: string): number {
  const minutes = parseHhMm(value);
  if (minutes === null) throw new Error(`Invalid schema-v16 service time: ${value}`);
  return minutes * 60;
}

function spanEndSeconds(start: string, end: string): number {
  const startSeconds = serviceTimeSeconds(start);
  const endSeconds = serviceTimeSeconds(end);
  return endSeconds <= startSeconds ? endSeconds + 86_400 : endSeconds;
}

function headwaySeconds(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isSafeInteger(minutes * 60)) {
    throw new Error(`Invalid schema-v16 headway: ${minutes}`);
  }
  return minutes * 60;
}
