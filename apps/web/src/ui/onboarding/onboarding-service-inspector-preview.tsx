import { MODES } from '@transitmapper/core/model/catalog';
import { formatDistance } from '@transitmapper/core/model/units';
import { InspectorTabs, type InspectorTab } from '../InspectorTabs';
import { Panel } from '../Panel';
import { useUnitPreference } from '../../services/userPreferences';
import { ServiceInspectorHeading } from '../inspector/service-inspector-heading';
import { ServiceLoadPresentation } from '../inspector/service-load-presentation';
import { ServiceScheduleFields } from '../inspector/service-schedule-fields';
import { formatMinutes } from '../inspector/shared';
import { ONBOARDING_FIXTURE_SYSTEM, ONBOARDING_SERVICE_STATS } from './fixtureSystem';

function requireCrosstownService() {
  const found = ONBOARDING_FIXTURE_SYSTEM.services.find(
    (candidate) => candidate.id === 'port-mason-crosstown',
  );
  if (!found) throw new Error('Port Mason onboarding requires the Crosstown service');
  return found;
}

const service = requireCrosstownService();

const tabs: InspectorTab[] = [
  { id: 'line', label: 'Line' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'route', label: 'Route' },
];

const lengthMeters = ONBOARDING_SERVICE_STATS.patterns.reduce(
  (total, pattern) => total + pattern.meters,
  0,
);
const totalStops = new Set(
  ONBOARDING_SERVICE_STATS.patterns.flatMap((pattern) =>
    pattern.stops.map((stop) => stop.station.id),
  ),
).size;
const stops = ONBOARDING_SERVICE_STATS.patterns.reduce(
  (most, pattern) => Math.max(most, pattern.stops.length),
  0,
);
const dwellMinutes =
  ONBOARDING_SERVICE_STATS.patterns.reduce((most, pattern) => Math.max(most, pattern.dwellMs), 0) /
  60_000;

/** A passive rendering of the editor's actual Service inspector Schedule tab.
 * It shares both child presentations with the live inspector and supplies only
 * values derived from the Port Mason fixture. */
export function OnboardingServiceInspectorPreview() {
  const unitSystem = useUnitPreference();
  return (
    <Panel
      slot="right"
      className="onboarding-service-inspector-preview"
      aria-label="Crosstown service schedule"
      aria-hidden="true"
    >
      <ServiceInspectorHeading
        color={service.color}
        name={service.name}
        modeLabel={MODES[service.modeId].label}
        distanceLabel={formatDistance(lengthMeters, unitSystem)}
        totalStops={totalStops}
        readOnly
      />

      <InspectorTabs tabs={tabs} active="schedule" onChange={() => undefined} disabled />

      <div className="insp-section" role="tabpanel">
        <ServiceLoadPresentation
          active={{ headwayMinutes: service.frequencyMinutes }}
          roundTrip={formatMinutes(ONBOARDING_SERVICE_STATS.longestRoundTripMs / 60_000)}
          fleet={ONBOARDING_SERVICE_STATS.fleet}
          when="8:30 AM"
          showPeriodLabel={false}
          stops={stops}
          dwellMinutes={dwellMinutes}
          branchCount={ONBOARDING_SERVICE_STATS.patterns.length}
          layoverMinutes={ONBOARDING_SERVICE_STATS.layoverMs / 60_000}
        />
        <ServiceScheduleFields
          idPrefix="onboarding-service-schedule"
          frequencyMinutes={service.frequencyMinutes}
          spanStart={service.spanStart}
          spanEnd={service.spanEnd}
          schedule={service.schedule}
          readOnly
          onFrequencyChange={() => undefined}
          onSpanChange={() => undefined}
          onOpenFullSchedule={() => undefined}
        />
      </div>
    </Panel>
  );
}
