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

// One early proposal develops across all five screens. Its bus services follow
// actual Charleston Boulevard and Las Vegas Boulevard geometry. Its light rail
// reuses the real freight corridor, then adds one clearly authored connection
// to the Downtown transfer.

const CHARLESTON_INTERSECTION: LngLat = [-115.1474526, 36.1589978];
const DOWNTOWN_TRANSFER: LngLat = [-115.1396365, 36.1709318];
const CHARLESTON_WEST_POINTS: LngLat[] = [
  [-115.1660028, 36.1589423],
  [-115.1634932, 36.1589545],
  [-115.161816, 36.1591451],
  [-115.1599869, 36.159164],
  [-115.1592675, 36.1591449],
  [-115.1575461, 36.1589594],
  [-115.1564973, 36.1589139],
  [-115.1504363, 36.1588931],
  CHARLESTON_INTERSECTION,
];
const CHARLESTON_EAST_POINTS: LngLat[] = [
  CHARLESTON_INTERSECTION,
  [-115.145, 36.15894],
  [-115.135454, 36.1589452],
  [-115.1353641, 36.1588756],
  [-115.1334334, 36.1588821],
  [-115.1333087, 36.1589502],
  [-115.1321443, 36.1589431],
  [-115.1319792, 36.1588768],
  [-115.1295157, 36.1588793],
  [-115.1293979, 36.1588334],
  [-115.1283189, 36.158828],
  [-115.1256681, 36.1589356],
];
const LAS_VEGAS_BOULEVARD_POINTS: LngLat[] = [
  CHARLESTON_INTERSECTION,
  [-115.146699, 36.1598929],
  [-115.145949, 36.1610722],
  [-115.1444226, 36.1634093],
  [-115.142128, 36.1668921],
  [-115.1406182, 36.1692162],
  DOWNTOWN_TRANSFER,
];

const RAIL_JUNCTION: LngLat = [-115.1512128, 36.1667266];
const RAIL_SOUTH_POINTS: LngLat[] = [
  [-115.157491, 36.1566503],
  [-115.1566931, 36.158173],
  [-115.1564724, 36.1586752],
  [-115.1562319, 36.1590499],
  [-115.1515332, 36.1662415],
  RAIL_JUNCTION,
];
const RAIL_NORTH_POINTS: LngLat[] = [
  RAIL_JUNCTION,
  [-115.149723, 36.169035],
  [-115.147211, 36.172885],
  [-115.1444387, 36.177],
];
const DOWNTOWN_CONNECTOR_POINTS: LngLat[] = [
  RAIL_JUNCTION,
  [-115.149047, 36.167779],
  [-115.145006, 36.169021],
  DOWNTOWN_TRANSFER,
];

function importedWay(id: string, typeId: 'road' | 'lightRail', points: LngLat[]): Way {
  return {
    id,
    typeId,
    points,
    geometry: 'freeform',
    // The Union Pacific corridor is grade-separated through this frame. That
    // preserves real road/rail crossings without inventing transit junctions.
    grade: typeId === 'lightRail' ? 'elevated' : 'atGrade',
    profile: defaultProfileFor(typeId),
    source: 'osm',
  };
}

const charlestonWest = importedWay('las-vegas-charleston-west', 'road', CHARLESTON_WEST_POINTS);
const charlestonEast = importedWay('las-vegas-charleston-east', 'road', CHARLESTON_EAST_POINTS);
const lasVegasBoulevard = importedWay(
  'las-vegas-boulevard-north',
  'road',
  LAS_VEGAS_BOULEVARD_POINTS,
);
const railSouth = importedWay('las-vegas-rail-south', 'lightRail', RAIL_SOUTH_POINTS);
const railNorth = importedWay('las-vegas-rail-north', 'lightRail', RAIL_NORTH_POINTS);

export const ONBOARDING_AUTHORED_CONNECTOR_ID = 'las-vegas-downtown-connector';
const downtownConnector: Way = {
  id: ONBOARDING_AUTHORED_CONNECTOR_ID,
  typeId: 'lightRail',
  points: DOWNTOWN_CONNECTOR_POINTS,
  geometry: 'freeform',
  grade: 'elevated',
  profile: defaultProfileFor('lightRail'),
};

const roadWays = [charlestonWest, charlestonEast, lasVegasBoulevard];
const railWays = [railSouth, railNorth, downtownConnector];

const roadJunction: Node = {
  id: 'las-vegas-charleston-boulevard-node',
  coord: CHARLESTON_INTERSECTION,
  refs: [
    { wayId: charlestonWest.id, pointIndex: charlestonWest.points.length - 1 },
    { wayId: charlestonEast.id, pointIndex: 0 },
    { wayId: lasVegasBoulevard.id, pointIndex: 0 },
  ],
};
const railJunction: Node = {
  id: 'las-vegas-rail-junction-node',
  coord: RAIL_JUNCTION,
  refs: [
    { wayId: railSouth.id, pointIndex: railSouth.points.length - 1 },
    { wayId: railNorth.id, pointIndex: 0 },
    { wayId: downtownConnector.id, pointIndex: 0 },
  ],
};

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

const downtownPattern: Pattern = {
  id: 'las-vegas-charleston-downtown-pattern',
  name: 'Downtown',
  sections: oneSection([wholeLeg(charlestonWest.id), wholeLeg(lasVegasBoulevard.id)]),
};
const huntridgePattern: Pattern = {
  id: 'las-vegas-charleston-huntridge-pattern',
  name: 'Huntridge',
  sections: oneSection([wholeLeg(charlestonWest.id), wholeLeg(charlestonEast.id)]),
};

const charlestonCrosstown: Service = {
  id: 'las-vegas-charleston-crosstown',
  name: 'Charleston Crosstown',
  modeId: 'bus',
  color: LINE_COLORS[0],
  patterns: [downtownPattern, huntridgePattern],
  frequencyMinutes: 10,
  spanStart: '06:00',
  spanEnd: '23:00',
};

const connectorPattern: Pattern = {
  id: 'las-vegas-downtown-connector-pattern',
  name: 'Downtown',
  sections: oneSection([wholeLeg(railSouth.id), wholeLeg(downtownConnector.id)]),
};
const connectorService: Service = {
  id: 'las-vegas-downtown-connector-service',
  name: 'Downtown Connector',
  modeId: 'lightRail',
  color: LINE_COLORS[1],
  patterns: [connectorPattern],
  frequencyMinutes: 12,
  spanStart: '06:00',
  spanEnd: '23:00',
};

const downtownTransfer: Station = {
  id: 'las-vegas-downtown-transfer',
  name: 'Downtown Transfer',
  coord: DOWNTOWN_TRANSFER,
  majorStop: true,
  anchors: [
    { wayId: lasVegasBoulevard.id, t: 1 },
    { wayId: downtownConnector.id, t: 1 },
  ],
};

const stations: Station[] = [
  stationOnWay('las-vegas-stop-medical-district', 'Medical District', charlestonWest, {
    t: 0,
    majorStop: true,
  }),
  stationOnWay('las-vegas-stop-rancho', 'Rancho Drive', charlestonWest, { t: 0.28 }),
  stationOnWay('las-vegas-stop-arts-district', 'Arts District', charlestonWest, { t: 0.58 }),
  stationOnWay('las-vegas-stop-charleston-las-vegas', 'Charleston & Las Vegas', charlestonWest, {
    t: 1,
  }),
  stationOnWay('las-vegas-stop-fremont', 'Fremont Street', lasVegasBoulevard, { t: 0.72 }),
  downtownTransfer,
  stationOnWay('las-vegas-stop-maryland', 'Maryland Parkway', charlestonEast, { t: 0.55 }),
  stationOnWay('las-vegas-stop-huntridge', 'Huntridge', charlestonEast, {
    t: 1,
    majorStop: true,
  }),
  stationOnWay('las-vegas-stop-rail-arts', 'Arts District Rail', railSouth, {
    t: 0,
    majorStop: true,
  }),
  stationOnWay('las-vegas-stop-symphony-park', 'Symphony Park', railSouth, { t: 0.86 }),
];

/** The one valid domain system every onboarding screen projects. */
export const ONBOARDING_FIXTURE_SYSTEM: TransitSystem = {
  ...createEmptySystem(0),
  id: 'central-las-vegas-onboarding-fixture',
  name: 'Central Las Vegas proposal',
  viewport: { center: [-115.146, 36.164], zoom: 13 },
  ways: [...roadWays, ...railWays],
  stations,
  services: [charlestonCrosstown, connectorService],
  nodes: [roadJunction, railJunction],
};

/** Drawing settles on the Downtown pattern before later screens introduce its
 * Huntridge branch and the rail proposal. */
export const ONBOARDING_DRAW_SYSTEM: TransitSystem = {
  ...ONBOARDING_FIXTURE_SYSTEM,
  ways: roadWays,
  nodes: [roadJunction],
  services: [{ ...charlestonCrosstown, patterns: [downtownPattern] }],
  stations: stations.filter((station) =>
    [
      'las-vegas-stop-medical-district',
      'las-vegas-stop-rancho',
      'las-vegas-stop-arts-district',
      'las-vegas-stop-charleston-las-vegas',
      'las-vegas-stop-fremont',
      'las-vegas-downtown-transfer',
    ].includes(station.id),
  ),
};

function requiredServiceStats(service: Service) {
  const stats = serviceStats(
    ONBOARDING_FIXTURE_SYSTEM.ways,
    ONBOARDING_FIXTURE_SYSTEM.stations,
    ONBOARDING_FIXTURE_SYSTEM.vehicleKinds,
    service,
    service.frequencyMinutes,
  );
  if (!stats || stats.patterns.some((pattern) => !pattern.plan)) {
    throw new Error(`Las Vegas ${service.name} failed to produce a simulation plan`);
  }
  return stats;
}

const crosstownStats = requiredServiceStats(charlestonCrosstown);
const connectorStats = requiredServiceStats(connectorService);
export const ONBOARDING_SERVICE_STATS = crosstownStats;

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
  ...vehicleRunsFor(charlestonCrosstown, crosstownStats.patterns),
  ...vehicleRunsFor(connectorService, connectorStats.patterns),
];

export const ONBOARDING_PATTERN_STATS = crosstownStats.patterns[0];
export const ONBOARDING_DRAW_PATH = ONBOARDING_PATTERN_STATS.path;

/** Infrastructure hides service overlays so the physical corridors carry the
 * story. Every other scene keeps both proposed modes visible. */
export function onboardingViewOptions(viewMode: ViewOptions['viewMode']): ViewOptions {
  return {
    viewMode,
    visibleModes: new Set(viewMode === 'infrastructure' ? [] : ['bus', 'lightRail']),
    visibleWayTypes: new Set(['road', 'lightRail']),
  };
}
