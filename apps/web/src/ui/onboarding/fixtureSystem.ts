import { LINE_COLORS } from '@transitmapper/core/model/catalog';
import { cumulativeLengths, oneSection, pointAtT, wholeLeg } from '@transitmapper/core/model/geo';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type {
  LngLat,
  Node,
  Pattern,
  Service,
  Stop,
  TransitSystem,
  Way,
} from '@transitmapper/core/model/system';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import {
  effectiveVehicleKind,
  serviceStats,
  type PatternStats,
} from '@transitmapper/core/sim/serviceStats';
import type { VehicleMotionProfile } from '@transitmapper/core/sim/timetable';

// Port Mason is deliberately place-shaped rather than geographically neutral.
// A river divides two differently sized street grids, one bridge constrains
// Crosstown, and the rail service has to leave a former freight alignment to
// reach the downtown transfer. It is still a small early proposal: two
// services and one branch decision, not a finished metropolitan network.

const WEST_X = [-122.49, -122.478, -122.466] as const;
const EAST_X = [-122.446, -122.434, -122.422] as const;
const STREET_Y = [37.738, 37.748, 37.758, 37.768] as const;
const CROSSTOWN_ROW = 2;

function roadId(
  bank: 'west' | 'east',
  direction: 'horizontal' | 'vertical',
  primary: number,
  secondary: number,
): string {
  return `port-mason-road-${bank}-${direction}-${primary}-${secondary}`;
}

function streetMidpoint(id: string, a: LngLat, b: LngLat): LngLat {
  let signature = 0;
  for (const character of id) signature += character.charCodeAt(0);
  const direction = signature % 2 === 0 ? 1 : -1;
  const bend = (0.00045 + (signature % 4) * 0.00016) * direction;
  const horizontal = Math.abs(a[0] - b[0]) > Math.abs(a[1] - b[1]);
  return horizontal
    ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + bend]
    : [(a[0] + b[0]) / 2 + bend, (a[1] + b[1]) / 2];
}

function gridRoad(id: string, a: LngLat, b: LngLat, bend = true): Way {
  return {
    id,
    typeId: 'road',
    points: bend ? [a, streetMidpoint(id, a, b), b] : [a, b],
    geometry: bend ? 'freeform' : 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
    source: 'osm',
  };
}

function bankRoads(bank: 'west' | 'east', xs: readonly number[]): Way[] {
  const ways: Way[] = [];
  for (let row = 0; row < STREET_Y.length; row++) {
    for (let column = 0; column < xs.length - 1; column++) {
      ways.push(
        gridRoad(
          roadId(bank, 'horizontal', row, column),
          [xs[column], STREET_Y[row]],
          [xs[column + 1], STREET_Y[row]],
        ),
      );
    }
  }
  for (let column = 0; column < xs.length; column++) {
    for (let row = 0; row < STREET_Y.length - 1; row++) {
      ways.push(
        gridRoad(
          roadId(bank, 'vertical', column, row),
          [xs[column], STREET_Y[row]],
          [xs[column], STREET_Y[row + 1]],
        ),
      );
    }
  }
  return ways;
}

const bridge: Way = gridRoad(
  'port-mason-harbor-bridge',
  [WEST_X[2], STREET_Y[CROSSTOWN_ROW]],
  [EAST_X[0], STREET_Y[CROSSTOWN_ROW]],
  false,
);

function arterialRoad(id: string, points: LngLat[]): Way {
  return {
    id,
    typeId: 'road',
    points,
    geometry: 'freeform',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
    source: 'osm',
  };
}

const westernArc = arterialRoad('port-mason-road-western-market-arc', [
  [WEST_X[0], STREET_Y[0]],
  [-122.497, 37.734],
  [-122.501, 37.758],
  [-122.486, 37.775],
  [WEST_X[2], STREET_Y[3]],
]);
const easternArc = arterialRoad('port-mason-road-east-belt', [
  [EAST_X[0], STREET_Y[0]],
  [-122.442, 37.731],
  [-122.417, 37.731],
  [-122.414, 37.766],
  [EAST_X[2], STREET_Y[3]],
]);
const roadWays = [
  ...bankRoads('west', WEST_X),
  ...bankRoads('east', EAST_X),
  westernArc,
  easternArc,
  bridge,
];

const UNIVERSITY: LngLat = [EAST_X[0] + 0.002, STREET_Y[3] + 0.009];
const FREIGHT_JUNCTION: LngLat = [EAST_X[0] + 0.002, STREET_Y[2] + 0.004];
const CENTRAL: LngLat = [EAST_X[1], STREET_Y[CROSSTOWN_ROW]];
const SOUTH_WORKS: LngLat = [EAST_X[0] + 0.002, STREET_Y[0] - 0.007];

function railWay(id: string, points: LngLat[], imported: boolean): Way {
  return {
    id,
    typeId: 'lightRail',
    points,
    geometry: 'straight',
    // Grade separation lets the former freight alignment cross the street
    // grid without pretending every crossing is a rail/road junction.
    grade: 'elevated',
    profile: defaultProfileFor('lightRail'),
    ...(imported ? { source: 'osm' } : {}),
  };
}

const railNorth = railWay('port-mason-rail-north-freight', [UNIVERSITY, FREIGHT_JUNCTION], true);
const railDowntownLink = railWay(
  'port-mason-rail-downtown-link',
  [FREIGHT_JUNCTION, CENTRAL],
  false,
);
const railSouth = railWay('port-mason-rail-south-freight', [CENTRAL, SOUTH_WORKS], true);
const railWays = [railNorth, railDowntownLink, railSouth];

function coordinateKey(coord: LngLat): string {
  return `${coord[0]},${coord[1]}`;
}

/** The imported road grid is already physical infrastructure. Explicit road
 * nodes make every block corner a real junction instead of a visual crossing.
 * Rail refs stay out: the elevated track crosses roads but never feeds them. */
function roadNodes(ways: Way[]): Node[] {
  const refs = new Map<string, { coord: LngLat; refs: Node['refs'] }>();
  for (const way of ways) {
    for (let pointIndex = 0; pointIndex < way.points.length; pointIndex++) {
      const coord = way.points[pointIndex];
      const key = coordinateKey(coord);
      const entry = refs.get(key) ?? { coord, refs: [] };
      entry.refs.push({ wayId: way.id, pointIndex });
      refs.set(key, entry);
    }
  }
  return [...refs.values()]
    .filter((entry) => entry.refs.length > 1)
    .map((entry, index) => ({
      id: `port-mason-road-node-${index}`,
      coord: entry.coord,
      refs: entry.refs,
    }));
}

interface StationOnWayOptions {
  t: number;
  majorStop?: boolean;
}

function stationOnWay(
  id: string,
  name: string,
  way: Way,
  { t, majorStop = false }: StationOnWayOptions,
): Station {
  return {
    id,
    name,
    coord: pointAtT(way.points, t),
    anchors: [{ wayId: way.id, t }],
    ...(majorStop ? { majorStop: true } : {}),
  };
}

function findRoad(id: string): Way {
  const way = roadWays.find((candidate) => candidate.id === id);
  if (!way) throw new Error(`Missing Port Mason road ${id}`);
  return way;
}

const westFirst = findRoad(roadId('west', 'horizontal', CROSSTOWN_ROW, 0));
const westSecond = findRoad(roadId('west', 'horizontal', CROSSTOWN_ROW, 1));
const downtownTrunk = findRoad(roadId('east', 'horizontal', CROSSTOWN_ROW, 0));
const eastgateBranch = findRoad(roadId('east', 'horizontal', CROSSTOWN_ROW, 1));
const airportSouth = findRoad(roadId('east', 'vertical', 1, 1));
const airportEast = findRoad(roadId('east', 'horizontal', 1, 1));
const airportFinal = findRoad(roadId('east', 'vertical', 2, 0));

const commonCrosstownLegs = [
  wholeLeg(westFirst.id),
  wholeLeg(westSecond.id),
  wholeLeg(bridge.id),
  wholeLeg(downtownTrunk.id),
];
const eastgatePattern: Pattern = {
  id: 'port-mason-crosstown-eastgate',
  name: 'Eastgate',
  sections: oneSection([...commonCrosstownLegs, wholeLeg(eastgateBranch.id)]),
};
const airportPattern: Pattern = {
  id: 'port-mason-crosstown-airport',
  name: 'Airport',
  sections: oneSection([
    ...commonCrosstownLegs,
    wholeLeg(airportSouth.id, 'againstPoints'),
    wholeLeg(airportEast.id),
    wholeLeg(airportFinal.id, 'againstPoints'),
  ]),
};

const crosstownService: Service = {
  id: 'port-mason-crosstown',
  name: 'Crosstown',
  modeId: 'bus',
  color: LINE_COLORS[0],
  patterns: [eastgatePattern, airportPattern],
  frequencyMinutes: 10,
  spanStart: '06:00',
  spanEnd: '23:00',
};

const harborPattern: Pattern = {
  id: 'port-mason-harbor-line-pattern',
  sections: oneSection([
    wholeLeg(railNorth.id),
    wholeLeg(railDowntownLink.id),
    wholeLeg(railSouth.id),
  ]),
};
const harborService: Service = {
  id: 'port-mason-harbor-line',
  name: 'Harbor Line',
  modeId: 'lightRail',
  color: LINE_COLORS[1],
  patterns: [harborPattern],
  frequencyMinutes: 12,
  spanStart: '06:00',
  spanEnd: '23:00',
};

const centralStation: Station = {
  id: 'port-mason-central-exchange',
  name: 'Central Exchange',
  coord: CENTRAL,
  majorStop: true,
  anchors: [
    { wayId: downtownTrunk.id, t: 1 },
    { wayId: eastgateBranch.id, t: 0 },
    { wayId: airportSouth.id, t: 1 },
    { wayId: railDowntownLink.id, t: 1 },
    { wayId: railSouth.id, t: 0 },
  ],
};

const stations: Station[] = [
  stationOnWay('port-mason-stop-west-market', 'West Market', westFirst, {
    t: 0.2,
    majorStop: true,
  }),
  stationOnWay('port-mason-stop-civic-square', 'Civic Square', westSecond, { t: 0.45 }),
  stationOnWay('port-mason-stop-riverfront', 'Riverfront', bridge, { t: 0.35 }),
  stationOnWay('port-mason-stop-downtown', 'Downtown', downtownTrunk, { t: 0.45 }),
  centralStation,
  stationOnWay('port-mason-stop-eastgate', 'Eastgate', eastgateBranch, {
    t: 1,
    majorStop: true,
  }),
  stationOnWay('port-mason-stop-airport-road', 'Airport Road', airportEast, { t: 0.55 }),
  stationOnWay('port-mason-stop-airport', 'Port Mason Airport', airportFinal, {
    t: 0,
    majorStop: true,
  }),
  stationOnWay('port-mason-stop-university', 'Port Mason University', railNorth, {
    t: 0,
    majorStop: true,
  }),
  stationOnWay('port-mason-stop-midtown', 'Midtown', railNorth, { t: 0.58 }),
  stationOnWay('port-mason-stop-south-works', 'South Works', railSouth, {
    t: 1,
    majorStop: true,
  }),
];

/** The one valid domain system all four onboarding scenes project. */
export const ONBOARDING_FIXTURE_SYSTEM: TransitSystem = {
  ...createEmptySystem(0),
  id: 'port-mason-onboarding-fixture',
  name: 'Port Mason proposal',
  viewport: { center: [-122.455, 37.755], zoom: 12.2 },
  ways: [...roadWays, ...railWays],
  stations,
  services: [crosstownService, harborService],
  nodes: roadNodes(roadWays),
};

/** Slide 1 reaches the first legible proposal, before the airport branch and
 * rail idea appear. It is a projection of the same stable records, not a
 * second hand-drawn illustration format. */
export const ONBOARDING_DRAW_SYSTEM: TransitSystem = {
  ...ONBOARDING_FIXTURE_SYSTEM,
  services: [{ ...crosstownService, patterns: [eastgatePattern] }],
  stations: stations.filter((station) =>
    [
      'port-mason-stop-west-market',
      'port-mason-stop-civic-square',
      'port-mason-stop-riverfront',
      'port-mason-stop-downtown',
      'port-mason-central-exchange',
      'port-mason-stop-eastgate',
    ].includes(station.id),
  ),
};

export interface OnboardingPlaceLabel {
  id: string;
  label: string;
  coord: LngLat;
  priority: 'primary' | 'secondary';
}

export const ONBOARDING_PLACE_LABELS: OnboardingPlaceLabel[] = [
  { id: 'west-market', label: 'West Market', coord: [WEST_X[0], STREET_Y[3]], priority: 'primary' },
  { id: 'downtown', label: 'Downtown', coord: [EAST_X[0], STREET_Y[3]], priority: 'primary' },
  { id: 'eastgate', label: 'Eastgate', coord: [EAST_X[2], STREET_Y[3]], priority: 'secondary' },
  { id: 'university', label: 'University', coord: UNIVERSITY, priority: 'secondary' },
  { id: 'south-works', label: 'South Works', coord: SOUTH_WORKS, priority: 'secondary' },
  {
    id: 'airport',
    label: 'Port Mason Airport',
    coord: [EAST_X[2], STREET_Y[0] - 0.003],
    priority: 'primary',
  },
];

export const ONBOARDING_NEW_RAIL_PATH = railDowntownLink.points;

function requiredServiceStats(service: Service) {
  const stats = serviceStats(
    ONBOARDING_FIXTURE_SYSTEM.ways,
    ONBOARDING_FIXTURE_SYSTEM.stations,
    ONBOARDING_FIXTURE_SYSTEM.vehicleKinds,
    service,
    service.frequencyMinutes,
  );
  if (!stats || stats.patterns.some((pattern) => !pattern.plan)) {
    throw new Error(`Port Mason ${service.name} failed to produce a simulation plan`);
  }
  return stats;
}

const crosstownStats = requiredServiceStats(crosstownService);
const harborStats = requiredServiceStats(harborService);

export interface OnboardingVehicleRun {
  id: string;
  color: string;
  stats: PatternStats;
  inboundCumLengths: Float64Array;
  profile: VehicleMotionProfile;
}

function vehicleRunsFor(service: Service, patterns: PatternStats[]): OnboardingVehicleRun[] {
  const profile = effectiveVehicleKind(ONBOARDING_FIXTURE_SYSTEM.vehicleKinds, service).profile;
  return patterns.map((stats) => ({
    id: stats.pattern.id,
    color: service.color,
    stats,
    inboundCumLengths: cumulativeLengths(stats.inboundPath),
    profile,
  }));
}

export const ONBOARDING_VEHICLE_RUNS = [
  ...vehicleRunsFor(crosstownService, crosstownStats.patterns),
  ...vehicleRunsFor(harborService, harborStats.patterns),
];
export const ONBOARDING_FLEET = crosstownStats.fleet;

export const ONBOARDING_PATTERN_STATS = crosstownStats.patterns[0];
export const ONBOARDING_SERVICE_COLOR = crosstownService.color;
export const ONBOARDING_DRAW_PATH = ONBOARDING_PATTERN_STATS.path;

/** Infrastructure hides the colored service overlay so physical corridors
 * carry the story. Every other scene keeps both proposed modes visible. */
export function onboardingViewOptions(viewMode: ViewOptions['viewMode']): ViewOptions {
  return {
    viewMode,
    visibleModes: new Set(viewMode === 'infrastructure' ? [] : ['bus', 'lightRail']),
    visibleWayTypes: new Set(['road', 'lightRail']),
  };
}
