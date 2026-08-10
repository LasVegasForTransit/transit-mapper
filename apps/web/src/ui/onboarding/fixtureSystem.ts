import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { cumulativeLengths, oneSection, pointAtT, wholeLeg } from '@transitmapper/core/model/geo';
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
  points: [[-115.1815, 36.1287], CROSSING, [-115.1705, 36.1318]],
  geometry: 'straight',
  grade: 'atGrade',
  profile: defaultProfileFor('road'),
};

const roadB: Way = {
  id: 'onboarding-road-b',
  typeId: 'road',
  points: [[-115.1776, 36.1255], CROSSING, [-115.1744, 36.1345]],
  geometry: 'straight',
  grade: 'atGrade',
  profile: defaultProfileFor('road'),
};

// A light-rail spine crosses the bus route at Central. Its geographic bends
// are deliberate: Network follows the actual corridor while Diagram snaps it
// into a schematic, so the final comparison teaches a visible difference.
const railSpine: Way = {
  id: 'onboarding-rail-spine',
  typeId: 'lightRail',
  points: [[-115.1752, 36.1245], CROSSING, [-115.1718, 36.1355]],
  geometry: 'straight',
  grade: 'atGrade',
  profile: defaultProfileFor('lightRail'),
};

// Only the two ROADS share the junction. The rail spine runs through the same
// coordinate without joining it: a junction is a lane graph, and a road and a
// light-rail line have no lanes that feed each other, so the app refuses to
// form one (see validate.ts's findMismatchedTypeJunctions). What the two of
// them meeting really needs is a level crossing, which the model has no
// primitive for yet.
const junctionNode: Node = {
  id: 'onboarding-junction',
  coord: CROSSING,
  refs: [
    { wayId: roadA.id, pointIndex: 1 },
    { wayId: roadB.id, pointIndex: 1 },
  ],
};

function crossingT(way: Way): number {
  const lengths = cumulativeLengths(way.points);
  return lengths[1] / lengths[lengths.length - 1];
}

function stationOnWay(id: string, name: string, way: Way, t: number): Station {
  return {
    id,
    name,
    coord: pointAtT(way.points, t),
    anchors: [{ wayId: way.id, t }],
  };
}

// Every stop is anchored to its corridor so Diagram carries it onto the
// schematic geometry instead of leaving geographic stop dots floating beside
// the straightened lines.
const stations: Station[] = [
  stationOnWay('onboarding-station-west', 'Westside', roadA, 0.18),
  // Central sits where the train crosses the bus route, but it rides the BUS
  // corridor only. Diagram keeps a stop on each corridor it is anchored to by
  // straightening that corridor around it, and it can only hold two corridors
  // together where they share a junction vertex — which a road and a rail
  // line never do. Anchoring Central to both would leave the schematic
  // drawing the train some 200 m away from its own stop.
  {
    id: 'onboarding-station-transfer',
    name: 'Central',
    coord: CROSSING,
    anchors: [{ wayId: roadA.id, t: crossingT(roadA) }],
  },
  stationOnWay('onboarding-station-east', 'Eastside', roadA, 0.82),
  stationOnWay('onboarding-station-north', 'North', railSpine, 0.82),
  stationOnWay('onboarding-station-south', 'South', railSpine, 0.18),
];

const busPattern: Pattern = {
  id: 'onboarding-bus-pattern',
  sections: oneSection([wholeLeg(roadA.id)]),
};

const busService: Service = {
  id: 'onboarding-bus-service',
  modeId: 'bus',
  path: { id: 'service-bus', sections: busPattern.sections },
  frequencyMinutes: 10,
};

const railPattern: Pattern = {
  id: 'onboarding-rail-pattern',
  sections: oneSection([wholeLeg(railSpine.id)]),
};

const railService: Service = {
  id: 'onboarding-rail-service',
  modeId: 'lightRail',
  path: { id: 'service-rail', sections: railPattern.sections },
  frequencyMinutes: 12,
};

/** The one fixture system every onboarding slide's preview map renders —
 *  same data, different `viewMode` per slide. */
export const ONBOARDING_FIXTURE_SYSTEM: TransitSystem = {
  ...createEmptySystem(0),
  id: 'onboarding-fixture',
  name: 'Community network',
  ways: [roadA, roadB, railSpine],
  stations,
  lines: [
    {
      id: 'onboarding-bus-line',
      name: 'Crosstown',
      color: LINE_COLORS[0],
      serviceIds: [busService.id],
    },
    {
      id: 'onboarding-rail-line',
      name: 'Valley Line',
      color: LINE_COLORS[1],
      serviceIds: [railService.id],
    },
  ],
  services: [busService, railService],
  nodes: [junctionNode],
};

// The Crosstown bus is the one animated service. Select it explicitly instead
// of relying on array position: this fixture deliberately contains multiple
// services, and adding another should never silently change which one moves.
const stats = serviceStats(
  [roadA, roadB, railSpine],
  stations,
  [],
  busService,
  busService.frequencyMinutes,
);
const animatedPattern = stats?.path;
if (!animatedPattern?.plan) {
  throw new Error('Onboarding fixture pattern failed to measure — check fixtureSystem.ts');
}

/** What slide 3's animation loop needs each frame: `runStateAt(simMs, ...)`
 *  for a vehicle position, then `pointAtDistance(path, cumLengths, distMeters)`
 *  for where to draw it. `runStateAt` reports which direction ("run") the
 *  vehicle is on; outbound and inbound are different geometry in general (a
 *  couplet's two directions ride different streets), so the caller needs
 *  both paths' arc lengths, not just the outbound one `PatternStats` already
 *  carries. */
export const ONBOARDING_PATTERN_STATS = animatedPattern;
export const ONBOARDING_INBOUND_CUM_LENGTHS = cumulativeLengths(animatedPattern.inboundPath);
export const ONBOARDING_VEHICLE_PROFILE = effectiveVehicleKind([], busService).profile;
export const ONBOARDING_SERVICE_COLOR = LINE_COLORS[0];

/** The preview keeps one system connected across the sequence. Infrastructure
 *  hides its service overlay so the roads, tracks, and junction are legible
 *  rather than looking like a recolored copy of Network. */
export function onboardingViewOptions(viewMode: ViewOptions['viewMode']): ViewOptions {
  return {
    viewMode,
    visibleModes: new Set(viewMode === 'infrastructure' ? [] : ['bus', 'lightRail']),
    visibleWayTypes: new Set(['road', 'lightRail']),
  };
}
