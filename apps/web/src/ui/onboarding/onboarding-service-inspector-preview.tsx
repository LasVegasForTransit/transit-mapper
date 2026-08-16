import { MODES } from '@transitmapper/core/model/catalog';
import { formatDistance } from '@transitmapper/core/model/units';
import { InspectorTabs, type InspectorTab } from '../InspectorTabs';
import { Panel } from '../Panel';
import { useUnitPreference } from '../../services/userPreferences';
import { ServiceInspectorHeading } from '../inspector/service-inspector-heading';
import { ServiceLoadPresentation } from '../inspector/service-load-presentation';
import { ServiceScheduleFields } from '../inspector/service-schedule-fields';
import { formatMinutes } from '../inspector/shared';
import {
  ONBOARDING_CROSSTOWN_LINE_ID,
  ONBOARDING_DOWNTOWN_SERVICE_ID,
  ONBOARDING_FIXTURE_SYSTEM,
  ONBOARDING_SERVICE_STATS,
} from './fixtureSystem';

function requireCrosstownService() {
  const found = ONBOARDING_FIXTURE_SYSTEM.services.find(
    (candidate) => candidate.id === ONBOARDING_DOWNTOWN_SERVICE_ID,
  );
  if (!found) throw new Error('Las Vegas onboarding requires the Charleston Crosstown service');
  return found;
}

const service = requireCrosstownService();

function requireCrosstownLine() {
  const found = ONBOARDING_FIXTURE_SYSTEM.lines.find(
    (candidate) => candidate.id === ONBOARDING_CROSSTOWN_LINE_ID,
  );
  if (!found) throw new Error('Las Vegas onboarding requires the Charleston Crosstown line');
  return found;
}

const line = requireCrosstownLine();

const tabs: InspectorTab[] = [
  { id: 'line', label: 'Service' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'route', label: 'Path' },
];

const lengthMeters = ONBOARDING_SERVICE_STATS.path.meters;
const totalStops = new Set(ONBOARDING_SERVICE_STATS.path.stops.map(({ stop }) => stop.id)).size;
const dwellMinutes = ONBOARDING_SERVICE_STATS.path.dwellMs / 60_000;

/** A passive rendering of the editor's actual Service inspector Schedule tab.
 * It shares both child presentations with the live inspector and supplies only
 * values derived from the central Las Vegas fixture. */
export function OnboardingServiceInspectorPreview() {
  const unitSystem = useUnitPreference();
  return (
    <Panel
      slot="right"
      className="onboarding-service-inspector-preview"
      aria-label="Charleston Crosstown service schedule"
      aria-hidden="true"
    >
      <ServiceInspectorHeading
        color={line.color}
        name={service.name}
        lineName={line.name}
        modeLabel={MODES[service.modeId].label}
        distanceLabel={formatDistance(lengthMeters, unitSystem)}
        totalStops={totalStops}
        readOnly
      />

      <InspectorTabs tabs={tabs} active="schedule" onChange={() => undefined} disabled />

      <div className="insp-section" role="tabpanel">
        <ServiceLoadPresentation
          active={{ headwayMinutes: service.frequencyMinutes }}
          roundTrip={formatMinutes(ONBOARDING_SERVICE_STATS.roundTripMs / 60_000)}
          fleet={ONBOARDING_SERVICE_STATS.fleet}
          when="8:30 AM"
          showPeriodLabel={false}
          stops={totalStops}
          dwellMinutes={dwellMinutes}
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
