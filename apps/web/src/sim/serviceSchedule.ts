import type { ScheduleDayScope, Service } from '@transitmapper/core/model/system';
import {
  activeSchedule,
  dayScopeAt,
  MS_PER_DAY,
  MS_PER_MINUTE,
  parseHhMm,
  type ActiveSchedule,
} from '@transitmapper/core/sim/clock';

/**
 * Resolve every service's active schedule at one simulated minute.
 *
 * The result remains valid until the minute, day scope, pinned period, or
 * service collection changes, so animation frames within that interval share
 * one table.
 */
export class ScheduleResolver {
  private key = '';
  private forServices: Service[] | null = null;
  private table = new Map<string, ActiveSchedule | null>();

  resolve(
    services: Service[],
    nowMin: number,
    dayScope: ScheduleDayScope,
    pinnedLabel: string | undefined,
  ): Map<string, ActiveSchedule | null> {
    const key = `${nowMin}|${dayScope}|${pinnedLabel ?? ''}`;
    if (key === this.key && services === this.forServices) return this.table;

    this.key = key;
    this.forServices = services;
    this.table = new Map();
    for (const service of services)
      this.table.set(service.id, activeSchedule(service, nowMin, dayScope, pinnedLabel));
    return this.table;
  }
}

/**
 * Find the next instant when one currently visible service can become active.
 *
 * Inactive services should not keep a 30 Hz loop alive. Schedule state can
 * change only at period starts or day boundaries, so checking those sparse
 * candidates over one weekly cycle provides an exact wake time.
 */
export function nextActiveServiceMs(services: Service[], simMs: number): number | null {
  const dayStart = Math.floor(simMs / MS_PER_DAY) * MS_PER_DAY;
  let next: number | null = null;
  const consider = (candidate: number) => {
    if (candidate > simMs && (next === null || candidate < next)) next = candidate;
  };

  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const candidateDay = dayStart + dayOffset * MS_PER_DAY;
    const candidateScope = dayScopeAt(candidateDay);
    for (const service of services) {
      const periods = service.schedule;
      if (periods && periods.length > 0) {
        for (const period of periods) {
          const start = parseHhMm(period.spanStart);
          const end = parseHhMm(period.spanEnd);
          if (
            start === null ||
            end === null ||
            (period.days !== 'daily' && period.days !== candidateScope)
          )
            continue;
          // Wrapped and all-day spans are active at midnight under
          // activeSchedule's current-day semantics.
          if (end <= start) consider(candidateDay);
          consider(candidateDay + start * MS_PER_MINUTE);
        }
        continue;
      }

      if (service.spanStart === undefined || service.spanEnd === undefined) continue;
      const start = parseHhMm(service.spanStart);
      const end = parseHhMm(service.spanEnd);
      if (start === null || end === null) continue;
      if (end <= start) consider(candidateDay);
      consider(candidateDay + start * MS_PER_MINUTE);
    }
  }

  return next;
}
