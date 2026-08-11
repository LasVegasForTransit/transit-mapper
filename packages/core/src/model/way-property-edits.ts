import { withLaneCount } from './profile';
import { shortId } from './ids';
import { reanchorStationsOnWay } from './station-reanchoring';
import type { CrossSection, DrivingSide, LineGeometry, NamedWay, TransitSystem } from './system';
import type { Grade } from './catalog';

export type CreateWayPropertyId = () => string;

function replaceWay(
  system: TransitSystem,
  id: string,
  update: (way: TransitSystem['ways'][number]) => TransitSystem['ways'][number],
): TransitSystem {
  const index = system.ways.findIndex((way) => way.id === id);
  if (index < 0) return system;
  const current = system.ways[index];
  const way = update(current);
  if (way === current) return system;
  const ways = [...system.ways];
  ways[index] = way;
  return { ...system, ways };
}

function withoutWay(namedWays: NamedWay[], wayId: string): NamedWay[] {
  if (!namedWays.some((namedWay) => namedWay.wayIds.includes(wayId))) return namedWays;
  return namedWays.flatMap((namedWay) => {
    if (!namedWay.wayIds.includes(wayId)) return [namedWay];
    const wayIds = namedWay.wayIds.filter((id) => id !== wayId);
    return wayIds.length > 0 ? [{ ...namedWay, wayIds }] : [];
  });
}

function sameProfile(left: CrossSection, right: CrossSection): boolean {
  if (left === right) return true;
  if (left.lanes.length !== right.lanes.length) return false;
  return left.lanes.every((lane, index) => {
    const other = right.lanes[index];
    return (
      lane.id === other.id &&
      lane.kindId === other.kindId &&
      lane.widthM === other.widthM &&
      lane.direction === other.direction
    );
  });
}

/** Replaces geometry and remeasures stations anchored to the rendered path. */
export function withWayGeometry(
  system: TransitSystem,
  id: string,
  geometry: LineGeometry,
): TransitSystem {
  const way = system.ways.find((candidate) => candidate.id === id);
  if (!way || way.geometry === geometry) return system;
  const next = replaceWay(system, id, (candidate) => ({ ...candidate, geometry }));
  return { ...next, stations: reanchorStationsOnWay(next, id) };
}

export function withWayGrade(system: TransitSystem, id: string, grade: Grade): TransitSystem {
  return replaceWay(system, id, (way) => (way.grade === grade ? way : { ...way, grade }));
}

export function withWayClass(
  system: TransitSystem,
  id: string,
  classId: string | undefined,
): TransitSystem {
  return replaceWay(system, id, (way) => (way.classId === classId ? way : { ...way, classId }));
}

/** Replaces a cross-section and removes connectors to lanes that disappeared. */
export function withWayProfile(
  system: TransitSystem,
  id: string,
  profile: CrossSection,
  classId?: string,
): TransitSystem {
  const way = system.ways.find((candidate) => candidate.id === id);
  if (!way) return system;
  const resolvedClassId = classId ?? way.classId;
  if (sameProfile(way.profile, profile) && way.classId === resolvedClassId) return system;
  const laneIds = new Set(profile.lanes.map((lane) => lane.id));
  const nodes = system.nodes.map((node) => {
    if (!node.connectors) return node;
    const connectors = node.connectors.filter(
      (connector) =>
        (connector.from.wayId !== id || laneIds.has(connector.from.laneId)) &&
        (connector.to.wayId !== id || laneIds.has(connector.to.laneId)),
    );
    if (connectors.length === node.connectors.length) return node;
    return { ...node, connectors: connectors.length > 0 ? connectors : undefined };
  });
  const next = replaceWay(system, id, (candidate) => ({
    ...candidate,
    profile,
    classId: resolvedClassId,
  }));
  return nodes.every((node, index) => node === system.nodes[index]) ? next : { ...next, nodes };
}

export function withWayCapacity(
  system: TransitSystem,
  id: string,
  capacity: number,
  drivingSide: DrivingSide,
): TransitSystem {
  const way = system.ways.find((candidate) => candidate.id === id);
  if (!way) return system;
  const profile = withLaneCount(way.profile, way.typeId, capacity, drivingSide);
  if (
    profile.lanes.length === way.profile.lanes.length &&
    profile.lanes.every((lane, index) => lane === way.profile.lanes[index])
  ) {
    return system;
  }
  return withWayProfile(system, id, profile);
}

/** Gives a way a shared street identity, joining an existing identity by name. */
export function nameWay(
  system: TransitSystem,
  wayId: string,
  name: string,
  createId: CreateWayPropertyId = shortId,
): TransitSystem {
  if (!system.ways.some((way) => way.id === wayId)) return system;
  const trimmed = name.trim();
  const current = system.namedWays.find((namedWay) => namedWay.wayIds.includes(wayId));
  if (!trimmed) {
    if (!current) return system;
    return { ...system, namedWays: withoutWay(system.namedWays, wayId) };
  }
  if (current) {
    if (current.name === trimmed) return system;
    return {
      ...system,
      namedWays: system.namedWays.map((namedWay) =>
        namedWay.id === current.id ? { ...namedWay, name: trimmed } : namedWay,
      ),
    };
  }
  const existing = system.namedWays.find((namedWay) => namedWay.name === trimmed);
  if (existing) {
    return {
      ...system,
      namedWays: system.namedWays.map((namedWay) =>
        namedWay.id === existing.id
          ? { ...namedWay, wayIds: [...namedWay.wayIds, wayId] }
          : namedWay,
      ),
    };
  }
  return {
    ...system,
    namedWays: [...system.namedWays, { id: createId(), name: trimmed, wayIds: [wayId] }],
  };
}

export function renameNamedWay(system: TransitSystem, id: string, name: string): TransitSystem {
  const trimmed = name.trim();
  const current = system.namedWays.find((namedWay) => namedWay.id === id);
  if (!current || current.name === trimmed) return system;
  return {
    ...system,
    namedWays: system.namedWays.map((namedWay) =>
      namedWay.id === id ? { ...namedWay, name: trimmed } : namedWay,
    ),
  };
}

/** Adds a newly branched way to its source way's shared identity. */
export function continueNamedWay(
  system: TransitSystem,
  sourceWayId: string,
  newWayId: string,
): TransitSystem {
  const identity = system.namedWays.find((namedWay) => namedWay.wayIds.includes(sourceWayId));
  if (!identity || identity.wayIds.includes(newWayId)) return system;
  return {
    ...system,
    namedWays: system.namedWays.map((namedWay) =>
      namedWay.id === identity.id
        ? { ...namedWay, wayIds: [...namedWay.wayIds, newWayId] }
        : namedWay,
    ),
  };
}
