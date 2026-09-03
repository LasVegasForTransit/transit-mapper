import type {
  Alignment,
  ApproachControl,
  Facility,
  Group,
  Median,
  NamedWay,
  Node,
  Platform,
  Station,
  Stop,
  TurnRestriction,
  VehicleKind,
  Way,
} from '../../transit/authored-system';
import type { CrossSection, CurveControl, LngLat } from '../../transit/value-types';
import {
  exactRecord,
  parseArray,
  parseBoolean,
  parseComponentMap,
  parseEnum,
  parseFiniteNumber,
  parseLngLat,
  parseNonnegativeInteger,
  parsePositiveInteger,
  parsePositiveNumber,
  parseText,
  parseUniqueTextArray,
} from './parse-values';

const GEOMETRIES = ['straight', 'curved', 'freeform'] as const;
const GRADES = ['underground', 'atGrade', 'elevated'] as const;
const LANE_DIRECTIONS = ['forward', 'reverse', 'both', 'none'] as const;
const NODE_CONTROLS = [
  'uncontrolled',
  'signal',
  'stop',
  'yield',
  'roundabout',
  'levelCrossing',
] as const;

function parseCurveControl(value: unknown, label: string): CurveControl {
  const record = exactRecord(value, label, ['pointIndex', 'radiusMeters']);
  return {
    pointIndex: parseNonnegativeInteger(record.pointIndex, `${label} point index`),
    radiusMeters: parsePositiveNumber(record.radiusMeters, `${label} radius`),
  };
}

export function parseAlignment(value: unknown, label: string): Alignment {
  const record = exactRecord(value, label, ['id', 'points', 'geometry'], ['curveControls']);
  const points = parseArray(record.points, `${label} points`, parseLngLat);
  if (points.length < 2 || new Set(points.map(([lng, lat]) => `${lng}\u0000${lat}`)).size < 2) {
    throw new Error(`${label} must contain at least two distinct points.`);
  }
  const alignment: Alignment = {
    id: parseText(record.id, `${label} ID`),
    points,
    geometry: parseEnum(record.geometry, `${label} geometry`, GEOMETRIES),
  };
  if ('curveControls' in record) {
    const controls = parseArray(record.curveControls, `${label} curve controls`, parseCurveControl);
    const indexes = new Set<number>();
    for (const control of controls) {
      if (control.pointIndex >= points.length || indexes.has(control.pointIndex)) {
        throw new Error(`${label} has an invalid or repeated curve-control point index.`);
      }
      indexes.add(control.pointIndex);
    }
    alignment.curveControls = controls;
  }
  return alignment;
}

function parseCrossSection(value: unknown, label: string): CrossSection {
  const record = exactRecord(value, label, ['lanes']);
  const lanes = parseArray(record.lanes, `${label} lanes`, (item, itemLabel) => {
    const lane = exactRecord(item, itemLabel, ['id', 'kindId', 'widthMeters', 'direction']);
    return {
      id: parseText(lane.id, `${itemLabel} ID`),
      kindId: parseText(lane.kindId, `${itemLabel} kind ID`),
      widthMeters: parsePositiveNumber(lane.widthMeters, `${itemLabel} width`),
      direction: parseEnum(lane.direction, `${itemLabel} direction`, LANE_DIRECTIONS),
    };
  });
  const laneIds = new Set(lanes.map((lane) => lane.id));
  if (laneIds.size !== lanes.length) throw new Error(`${label} repeats a lane ID.`);
  return { lanes };
}

export function parseWay(value: unknown, label: string): Way {
  const record = exactRecord(
    value,
    label,
    ['id', 'alignmentId', 'typeId', 'grade', 'profile'],
    ['classId'],
  );
  const way: Way = {
    id: parseText(record.id, `${label} ID`),
    alignmentId: parseText(record.alignmentId, `${label} Alignment ID`),
    typeId: parseText(record.typeId, `${label} type ID`),
    grade: parseEnum(record.grade, `${label} grade`, GRADES),
    profile: parseCrossSection(record.profile, `${label} profile`),
  };
  if ('classId' in record) way.classId = parseText(record.classId, `${label} class ID`);
  return way;
}

export function parseStop(value: unknown, label: string): Stop {
  const record = exactRecord(
    value,
    label,
    ['id', 'coord', 'anchors'],
    ['name', 'stationId', 'autoNamed', 'dwellSeconds', 'majorStop'],
  );
  const stop: Stop = {
    id: parseText(record.id, `${label} ID`),
    coord: parseLngLat(record.coord, `${label} coordinate`),
    anchors: parseArray(record.anchors, `${label} anchors`, (item, itemLabel) => {
      const anchor = exactRecord(item, itemLabel, ['alignmentId', 't']);
      const t = parseFiniteNumber(anchor.t, `${itemLabel} position`);
      if (t < 0 || t > 1) throw new Error(`${itemLabel} position must be from zero through one.`);
      return {
        alignmentId: parseText(anchor.alignmentId, `${itemLabel} Alignment ID`),
        t,
      };
    }),
  };
  if ('name' in record) stop.name = parseText(record.name, `${label} name`);
  if ('stationId' in record) stop.stationId = parseText(record.stationId, `${label} Station ID`);
  if ('autoNamed' in record) stop.autoNamed = parseBoolean(record.autoNamed, `${label} auto-named`);
  if ('dwellSeconds' in record) {
    stop.dwellSeconds = parseNonnegativeInteger(record.dwellSeconds, `${label} dwell time`);
  }
  if ('majorStop' in record) stop.majorStop = parseBoolean(record.majorStop, `${label} major flag`);
  return stop;
}

function parsePlatform(value: unknown, label: string): Platform {
  const record = exactRecord(value, label, ['id', 'points'], ['edges']);
  const platform: Platform = {
    id: parseText(record.id, `${label} ID`),
    points: parseArray(record.points, `${label} points`, parseLngLat),
  };
  if ('edges' in record) platform.edges = parseNonnegativeInteger(record.edges, `${label} edges`);
  return platform;
}

export function parseStation(value: unknown, label: string): Station {
  const record = exactRecord(value, label, ['id', 'coord'], ['name', 'footprint', 'platforms']);
  const station: Station = {
    id: parseText(record.id, `${label} ID`),
    coord: parseLngLat(record.coord, `${label} coordinate`),
  };
  if ('name' in record) station.name = parseText(record.name, `${label} name`);
  if ('footprint' in record) {
    station.footprint = parseArray(record.footprint, `${label} footprint`, parseLngLat);
  }
  if ('platforms' in record) {
    station.platforms = parseArray(record.platforms, `${label} platforms`, parsePlatform);
  }
  return station;
}

function parseGeometry(value: unknown, label: string): LngLat | LngLat[] {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === 'number')
  ) {
    return parseLngLat(value, label);
  }
  return parseArray(value, label, parseLngLat);
}

export function parseFacility(value: unknown, label: string): Facility {
  const record = exactRecord(value, label, ['id', 'typeId', 'geometry'], ['name']);
  const facility: Facility = {
    id: parseText(record.id, `${label} ID`),
    typeId: parseText(record.typeId, `${label} type ID`),
    geometry: parseGeometry(record.geometry, `${label} geometry`),
  };
  if ('name' in record) facility.name = parseText(record.name, `${label} name`);
  return facility;
}

export function parseGroup(value: unknown, label: string): Group {
  const record = exactRecord(value, label, ['id', 'memberIds'], ['name', 'footprint', 'color']);
  const group: Group = {
    id: parseText(record.id, `${label} ID`),
    memberIds: parseArray(record.memberIds, `${label} member IDs`, parseText),
  };
  if ('name' in record) group.name = parseText(record.name, `${label} name`);
  if ('footprint' in record) {
    group.footprint = parseArray(record.footprint, `${label} footprint`, parseLngLat);
  }
  if ('color' in record) group.color = parseText(record.color, `${label} color`);
  return group;
}

export function parseNode(value: unknown, label: string): Node {
  const record = exactRecord(value, label, ['id', 'coord', 'refs'], ['control', 'connectors']);
  const node: Node = {
    id: parseText(record.id, `${label} ID`),
    coord: parseLngLat(record.coord, `${label} coordinate`),
    refs: parseArray(record.refs, `${label} references`, (item, itemLabel) => {
      const ref = exactRecord(item, itemLabel, ['wayId', 'pointIndex']);
      return {
        wayId: parseText(ref.wayId, `${itemLabel} Way ID`),
        pointIndex: parseNonnegativeInteger(ref.pointIndex, `${itemLabel} point index`),
      };
    }),
  };
  if ('control' in record) {
    node.control = parseEnum(record.control, `${label} control`, NODE_CONTROLS);
  }
  if ('connectors' in record) {
    node.connectors = parseArray(record.connectors, `${label} connectors`, (item, itemLabel) => {
      const connector = exactRecord(item, itemLabel, ['from', 'to']);
      const parseEndpoint = (endpoint: unknown, endpointLabel: string) => {
        const parsed = exactRecord(endpoint, endpointLabel, ['wayId', 'laneId']);
        return {
          wayId: parseText(parsed.wayId, `${endpointLabel} Way ID`),
          laneId: parseText(parsed.laneId, `${endpointLabel} lane ID`),
        };
      };
      return {
        from: parseEndpoint(connector.from, `${itemLabel} from`),
        to: parseEndpoint(connector.to, `${itemLabel} to`),
      };
    });
  }
  return node;
}

export function parseNamedWay(value: unknown, label: string): NamedWay {
  const record = exactRecord(value, label, ['id', 'name', 'wayIds']);
  return {
    id: parseText(record.id, `${label} ID`),
    name: parseText(record.name, `${label} name`),
    wayIds: parseUniqueTextArray(record.wayIds, `${label} Way IDs`),
  };
}

export function parseVehicleKind(value: unknown, label: string): VehicleKind {
  const record = exactRecord(
    value,
    label,
    ['id', 'modeId', 'label', 'widthM', 'lengthM'],
    ['capacityPax', 'topSpeedKmh', 'accelMps2', 'decelMps2'],
  );
  const kind: VehicleKind = {
    id: parseText(record.id, `${label} ID`),
    modeId: parseText(record.modeId, `${label} mode ID`),
    label: parseText(record.label, `${label} label`),
    widthM: parsePositiveNumber(record.widthM, `${label} width`),
    lengthM: parsePositiveNumber(record.lengthM, `${label} length`),
  };
  if ('capacityPax' in record) {
    kind.capacityPax = parsePositiveInteger(record.capacityPax, `${label} capacity`);
  }
  if ('topSpeedKmh' in record) {
    kind.topSpeedKmh = parsePositiveNumber(record.topSpeedKmh, `${label} top speed`);
  }
  if ('accelMps2' in record) {
    kind.accelMps2 = parsePositiveNumber(record.accelMps2, `${label} acceleration`);
  }
  if ('decelMps2' in record) {
    kind.decelMps2 = parsePositiveNumber(record.decelMps2, `${label} deceleration`);
  }
  return kind;
}

export function parseTurnRestrictions(value: unknown): Record<string, TurnRestriction> {
  return parseComponentMap(value, 'Turn restrictions', (item, label) => {
    const record = exactRecord(item, label, ['allowedTargets']);
    return {
      allowedTargets: parseUniqueTextArray(record.allowedTargets, `${label} allowed targets`),
    };
  });
}

export function parseMedians(value: unknown): Record<string, Median> {
  return parseComponentMap(value, 'Medians', (item, label) => {
    const record = exactRecord(item, label, ['widthM', 'kindId']);
    return {
      widthM: parsePositiveNumber(record.widthM, `${label} width`),
      kindId: parseText(record.kindId, `${label} kind ID`),
    };
  });
}

export function parseApproachControls(value: unknown): Record<string, ApproachControl> {
  return parseComponentMap(value, 'Approach controls', (item, label) => {
    const record = exactRecord(item, label, ['control']);
    return { control: parseEnum(record.control, `${label} control`, NODE_CONTROLS) };
  });
}
