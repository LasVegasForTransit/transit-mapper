import type { ActiveSchedule } from '@transitmapper/core/sim/clock';
import { Stat, formatMinutes } from './shared';

export interface ServiceLoadPresentationProps {
  active: ActiveSchedule | null;
  roundTrip: string;
  fleet: number;
  when: string;
  showPeriodLabel: boolean;
  stops: number;
  dwellMinutes: number;
  branchCount: number;
  layoverMinutes: number;
}

function activeServiceDescription({
  active,
  roundTrip,
  fleet,
  when,
  showPeriodLabel,
  stops,
  dwellMinutes,
  branchCount,
  layoverMinutes,
}: ServiceLoadPresentationProps): string {
  if (!active) return `Not running at ${when}. A round trip takes ${roundTrip}.`;
  if (active.headwayMinutes === undefined) {
    return `Running at ${when} with no frequency set, so it runs a single vehicle around a ${roundTrip} round trip.`;
  }
  const period = showPeriodLabel && active.label ? ` (${active.label})` : '';
  const stopDetail =
    stops === 0
      ? 'With no stops'
      : `${stops} stop${stops === 1 ? '' : 's'} and ${formatMinutes(dwellMinutes)} of dwell`;
  const branches = branchCount > 1 ? ` across ${branchCount} branches` : '';
  return (
    `At ${when} it runs every ${active.headwayMinutes} min${period}. ` +
    `${stopDetail}, a round trip takes ${roundTrip}, so holding that headway needs ` +
    `${fleet} vehicle${fleet === 1 ? '' : 's'}${branches}, each waiting ` +
    `${formatMinutes(layoverMinutes)} at either end.`
  );
}

/** The operating consequence shown by the Service inspector. It accepts only
 * core-derived facts so the live editor and read-only onboarding preview use
 * the same labels, layout, and explanatory chain. */
export function ServiceLoadPresentation({
  active,
  roundTrip,
  fleet,
  when,
  showPeriodLabel,
  stops,
  dwellMinutes,
  branchCount,
  layoverMinutes,
}: ServiceLoadPresentationProps) {
  const description = activeServiceDescription({
    active,
    roundTrip,
    fleet,
    when,
    showPeriodLabel,
    stops,
    dwellMinutes,
    branchCount,
    layoverMinutes,
  });
  return (
    <>
      <div className="stats">
        <Stat label="Round trip" value={roundTrip} />
        {active && <Stat label="Vehicles" value={String(fleet)} />}
      </div>
      <p className="panel-hint">{description}</p>
    </>
  );
}
