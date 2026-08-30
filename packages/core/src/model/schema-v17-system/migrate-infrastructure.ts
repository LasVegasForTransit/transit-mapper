import type { TransitSystem as SchemaV16TransitSystem } from '../system';
import type { Alignment, Group, Stop, Way } from '../../transit/authored-system';
import { legacyEntityReferences, type LegacyEntityReferenceMap } from './legacy-references';

export function migrateAlignment(way: SchemaV16TransitSystem['ways'][number]): Alignment {
  return {
    id: way.id,
    points: way.points.map(([longitude, latitude]) => [longitude, latitude]),
    geometry: way.geometry,
    ...(way.curveControls === undefined
      ? {}
      : {
          curveControls: way.curveControls.map((control) => ({
            pointIndex: control.pointIndex,
            radiusMeters: control.radiusM,
          })),
        }),
  };
}

export function migrateWay(way: SchemaV16TransitSystem['ways'][number]): Way {
  return {
    id: way.id,
    alignmentId: way.id,
    typeId: way.typeId,
    grade: way.grade,
    profile: {
      lanes: way.profile.lanes.map((lane) => ({
        id: lane.id,
        kindId: lane.kindId,
        widthMeters: lane.widthM,
        direction: lane.direction === 'backward' ? 'reverse' : lane.direction,
      })),
    },
    ...(way.classId === undefined ? {} : { classId: way.classId }),
  };
}

export function migrateStop(stop: SchemaV16TransitSystem['stops'][number]): Stop {
  return {
    id: stop.id,
    ...(stop.name === undefined ? {} : { name: stop.name }),
    ...(stop.stationId === undefined ? {} : { stationId: stop.stationId }),
    ...(stop.autoNamed === undefined ? {} : { autoNamed: stop.autoNamed }),
    coord: [stop.coord[0], stop.coord[1]],
    anchors: stop.anchors.map((anchor) => ({ alignmentId: anchor.wayId, t: anchor.t })),
    ...(stop.dwellSeconds === undefined ? {} : { dwellSeconds: stop.dwellSeconds }),
    ...(stop.majorStop === undefined ? {} : { majorStop: stop.majorStop }),
  };
}

function migrateGroup(
  group: SchemaV16TransitSystem['groups'][number],
  references: LegacyEntityReferenceMap,
): Group {
  const members = group.memberIds.map((memberId) => {
    const candidates = references.get(memberId);
    if (!candidates || candidates.length !== 1) {
      throw new Error(`Cannot migrate ambiguous schema-v16 Group member: ${memberId}`);
    }
    return candidates[0]!;
  });
  return {
    id: group.id,
    ...(group.name === undefined ? {} : { name: group.name }),
    members,
    ...(group.footprint === undefined
      ? {}
      : { footprint: group.footprint.map(([longitude, latitude]) => [longitude, latitude]) }),
    ...(group.color === undefined ? {} : { color: group.color }),
  };
}

export function migratedSystemBase(
  system: SchemaV16TransitSystem,
): Omit<
  import('../../transit/authored-system').TransitSystem,
  | 'version'
  | 'lines'
  | 'servicePlans'
  | 'patterns'
  | 'schedules'
  | 'calendars'
  | 'trips'
  | 'frequencyRules'
  | 'legacyServiceAliases'
> {
  const references = legacyEntityReferences(system);
  return {
    id: system.id,
    name: system.name,
    ...(system.description === undefined ? {} : { description: system.description }),
    viewport: { ...system.viewport },
    createdAt: system.createdAt,
    updatedAt: system.updatedAt,
    alignments: system.ways.map(migrateAlignment),
    ways: system.ways.map(migrateWay),
    stops: system.stops.map(migrateStop),
    stations: system.stations.map((station) => ({ ...station })),
    facilities: system.facilities.map((facility) => ({ ...facility })),
    groups: system.groups.map((group) => migrateGroup(group, references)),
    nodes: system.nodes.map((node) => ({ ...node })),
    namedWays: system.namedWays.map((namedWay) => ({ ...namedWay })),
    vehicleKinds: system.vehicleKinds.map((vehicleKind) => ({ ...vehicleKind })),
    palette: [...system.palette],
    drivingSide: system.drivingSide,
    turnRestrictions: { ...system.turnRestrictions },
    medians: { ...system.medians },
    approachControls: { ...system.approachControls },
    sourceCitations: [],
    sourceBindings: [],
    legacySourceReferences: system.ways.flatMap((way) =>
      way.source === undefined
        ? []
        : [{ target: { kind: 'way' as const, id: way.id }, value: way.source }],
    ),
    importHistory: [],
  };
}
