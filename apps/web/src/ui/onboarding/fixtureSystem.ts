import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { cumulativeLengths, oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import { LINE_COLORS } from '@transitmapper/core/model/catalog';
import { effectiveVehicleKind, serviceStats } from '@transitmapper/core/sim/serviceStats';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import type {
  Node,
  Pattern,
  Service,
  Station,
  TransitSystem,
  Way,
} from '@transitmapper/core/model/system';

// A tiny, hand-built system for the onboarding dialog's live previews — never
// saved, never shown to buildFeatures' callers as anything but a picture.
// Built from plain object literals plus real model helpers (defaultProfileFor,
// oneSection/wholeLeg), not @transitmapper/core/testing/fixtures builders:
// those exist for tests, and importing a testing module into a shipped
// feature would be a layering violation the rest of the codebase doesn't have.

const CROSSING: [number, number] = [-115.176, 36.13];

// Two roads crossing at CROSSING, sharing that exact coordinate as a control
// point on both — the same shape the editor's own junction-splitting leaves
// behind, so the Infrastructure preview shows a real junction, not two lines
// that happen to overlap.
const roadA: Way = {
  id: 'onboarding-road-a',
  typeId: 'road',
  points: [[-115.1815, 36.13], CROSSING, [-115.1705, 36.13]],
  geometry: 'straight',
  grade: 'atGrade',
  profile: defaultProfileFor('road'),
};

const roadB: Way = {
  id: 'onboarding-road-b',
  typeId: 'road',
  points: [[-115.176, 36.1255], CROSSING, [-115.176, 36.1345]],
  geometry: 'straight',
  grade: 'atGrade',
  profile: defaultProfileFor('road'),
};

const junctionNode: Node = {
  id: 'onboarding-junction',
  coord: CROSSING,
  refs: [
    { wayId: roadA.id, pointIndex: 1 },
    { wayId: roadB.id, pointIndex: 1 },
  ],
};

// Unsnapped (empty `anchors`) is simplest and valid here — it only needs to
// sit near the junction for the preview, not ride a specific way.
const station: Station = {
  id: 'onboarding-station',
  name: 'Crossing',
  coord: [-115.1785, 36.13],
  anchors: [],
};

const pattern: Pattern = {
  id: 'onboarding-pattern',
  sections: oneSection([wholeLeg(roadA.id)]),
};

const service: Service = {
  id: 'onboarding-service',
  name: 'Sample line',
  modeId: 'bus',
  color: LINE_COLORS[0],
  patterns: [pattern],
  frequencyMinutes: 10,
};

/** The one fixture system every onboarding slide's preview map renders —
 *  same data, different `viewMode` per slide. */
export const ONBOARDING_FIXTURE_SYSTEM: TransitSystem = {
  ...createEmptySystem(0),
  id: 'onboarding-fixture',
  name: 'Sample system',
  ways: [roadA, roadB],
  stations: [station],
  services: [service],
  nodes: [junctionNode],
};

// Measured once, at module load, since the fixture never changes — the same
// serviceStats() the real Inspector and vehicle animation call, so slide 3's
// preview moves on exactly the numbers a real drawn line would.
const stats = serviceStats([roadA, roadB], [station], [], service, service.frequencyMinutes);
const onlyPattern = stats?.patterns[0];
if (!onlyPattern || !onlyPattern.plan) {
  throw new Error('Onboarding fixture pattern failed to measure — check fixtureSystem.ts');
}

/** What slide 3's animation loop needs each frame: `runStateAt(simMs, ...)`
 *  for a vehicle position, then `pointAtDistance(path, cumLengths, distMeters)`
 *  for where to draw it. `runStateAt` reports which direction ("run") the
 *  vehicle is on; outbound and inbound are different geometry in general (a
 *  couplet's two directions ride different streets), so the caller needs
 *  both paths' arc lengths, not just the outbound one `PatternStats` already
 *  carries. */
export const ONBOARDING_PATTERN_STATS = onlyPattern;
export const ONBOARDING_INBOUND_CUM_LENGTHS = cumulativeLengths(onlyPattern.inboundPath);
export const ONBOARDING_VEHICLE_PROFILE = effectiveVehicleKind([], service).profile;
export const ONBOARDING_SERVICE_COLOR = service.color;

/** The fixture only ever has one mode (bus) on one way type (road) — every
 *  slide's preview just switches `viewMode`. */
export function onboardingViewOptions(viewMode: ViewOptions['viewMode']): ViewOptions {
  return {
    viewMode,
    visibleModes: new Set(['bus']),
    visibleWayTypes: new Set(['road']),
  };
}
