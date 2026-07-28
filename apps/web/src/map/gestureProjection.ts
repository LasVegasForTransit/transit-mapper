import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  LineString,
  Point,
  Polygon,
} from 'geojson';
import { resolveWayPath } from '@transitmapper/core/model/geo';
import type {
  Facility,
  Group,
  LngLat,
  Node,
  Station,
  TransitSystem,
  Way,
} from '@transitmapper/core/model/system';

export interface GestureWayPointTarget {
  wayId: string;
  pointIndex: number;
}

/** Exact entities a pointer gesture is allowed to mutate. Interaction handlers
 * know these before their first store write, so projection never has to diff
 * every way/station at pointer-frame frequency. */
export interface EditGestureTargets {
  wayIds?: string[];
  wayPoints?: GestureWayPointTarget[];
  stationIds?: string[];
  facilityIds?: string[];
  groupIds?: string[];
  nodeIds?: string[];
  /** Freehand creates its way only after movement crosses the drag threshold.
   * One added way may be discovered once; anything larger aborts the scratch
   * path as a concurrent bulk mutation. */
  discoverNewWay?: boolean;
}

export interface GestureAffectedEntities {
  wayIds: string[];
  stationIds: string[];
  facilityIds: string[];
  groupIds: string[];
  nodeIds: string[];
}

export interface GestureProjection {
  data: FeatureCollection<Geometry>;
  affected: GestureAffectedEntities;
}

export interface ProjectionOperationCounts {
  fullProjectionCount: number;
  gestureProjectionCount: number;
  sourceUploadCount: number;
  entityComparisonCount: number;
  projectedEntityCount: number;
}

export type GestureProjectionResult =
  { kind: 'preview'; projection: GestureProjection } | { kind: 'none' } | { kind: 'abort' };

export interface GestureProjectionFinish {
  rebuild: boolean;
  hadPreview: boolean;
}

export interface GestureProjectionController {
  affected: () => GestureAffectedEntities;
  addTargets: (system: TransitSystem, targets: EditGestureTargets) => GestureAffectedEntities;
  project: (system: TransitSystem) => GestureProjectionResult;
  finish: () => GestureProjectionFinish;
}

declare global {
  interface Window {
    /** Deterministic development-only counts for drag projection attribution. */
    __mapProjectionCounts?: () => ProjectionOperationCounts;
  }
}

export function createProjectionOperationCounts(): ProjectionOperationCounts {
  return {
    fullProjectionCount: 0,
    gestureProjectionCount: 0,
    sourceUploadCount: 0,
    entityComparisonCount: 0,
    projectedEntityCount: 0,
  };
}

/**
 * Coordinates a single pointer gesture. It indexes only the explicit target
 * IDs at start, then resolves those stable array slots on each frame. A joined
 * control point expands once to its node's other ways; stations anchored to a
 * moved way expand once too. RTC-scale arrays are never scanned per frame.
 */
export function createGestureProjectionController(
  baseline: TransitSystem,
  initialTargets: EditGestureTargets,
  counts: ProjectionOperationCounts,
): GestureProjectionController {
  const documentId = baseline.id;
  const baselineInputs = renderInputs(baseline);
  const baselineWayIds = new Set(baseline.ways.map((way) => way.id));
  let allowNewWayDiscovery = initialTargets.discoverNewWay === true;
  const allowServiceChange = allowNewWayDiscovery;
  let affected = expandTargets(baseline, initialTargets);
  let locators = createLocators(baseline, affected);
  let dirty = false;
  let aborted = false;
  let hadPreview = false;

  const addTargets = (
    system: TransitSystem,
    targets: EditGestureTargets,
  ): GestureAffectedEntities => {
    affected = mergeAffected(affected, expandTargets(system, targets));
    locators = createLocators(system, affected);
    return copyAffected(affected);
  };

  const project = (system: TransitSystem): GestureProjectionResult => {
    if (aborted) return { kind: 'abort' };
    if (system.id !== documentId) {
      aborted = true;
      return { kind: 'abort' };
    }

    if (allowNewWayDiscovery && affected.wayIds.length === 0 && system.ways !== baseline.ways) {
      const added = system.ways.filter((way) => !baselineWayIds.has(way.id));
      if (added.length !== 1) {
        aborted = true;
        return { kind: 'abort' };
      }
      addTargets(system, { wayIds: [added[0].id] });
      allowNewWayDiscovery = false;
    }

    if (
      unexpectedInputChange(
        baselineInputs,
        system,
        affected,
        allowServiceChange,
        allowNewWayDiscovery,
      )
    ) {
      aborted = true;
      return { kind: 'abort' };
    }

    counts.gestureProjectionCount++;
    if (system !== baseline) dirty = true;
    const features: Feature<Geometry>[] = [];
    const ways = locators.ways.resolve(system.ways, counts);
    const stations = locators.stations.resolve(system.stations, counts);
    const facilities = locators.facilities.resolve(system.facilities, counts);
    const groups = locators.groups.resolve(system.groups, counts);
    const nodes = locators.nodes.resolve(system.nodes, counts);
    counts.projectedEntityCount +=
      ways.length + stations.length + facilities.length + groups.length + nodes.length;

    for (const way of ways) features.push(...projectWay(way));
    for (const station of stations) features.push(...projectStation(station));
    for (const facility of facilities) features.push(...projectFacility(facility));
    for (const group of groups) features.push(...projectGroup(group));
    for (const node of nodes) features.push(projectNode(node));

    hadPreview ||= features.length > 0;
    return {
      kind: features.length > 0 ? 'preview' : 'none',
      ...(features.length > 0
        ? {
            projection: {
              data: { type: 'FeatureCollection', features },
              affected: copyAffected(affected),
            },
          }
        : {}),
    } as GestureProjectionResult;
  };

  return {
    affected: () => copyAffected(affected),
    addTargets,
    project,
    finish: () => ({ rebuild: dirty || aborted, hadPreview }),
  };
}

export function recordSourceUpload(counts: ProjectionOperationCounts): void {
  counts.sourceUploadCount++;
}

export function recordFullProjection(
  counts: ProjectionOperationCounts,
  sourceUploads: number,
): void {
  counts.fullProjectionCount++;
  counts.sourceUploadCount += sourceUploads;
}

interface Entity {
  id: string;
}

interface EntityLocator<T extends Entity> {
  resolve: (entities: T[], counts: ProjectionOperationCounts) => T[];
}

interface GestureLocators {
  ways: EntityLocator<Way>;
  stations: EntityLocator<Station>;
  facilities: EntityLocator<Facility>;
  groups: EntityLocator<Group>;
  nodes: EntityLocator<Node>;
}

interface RenderInputReferences {
  ways: TransitSystem['ways'];
  services: TransitSystem['services'];
  stations: TransitSystem['stations'];
  facilities: TransitSystem['facilities'];
  groups: TransitSystem['groups'];
  nodes: TransitSystem['nodes'];
  namedWays: TransitSystem['namedWays'];
  turnRestrictions: TransitSystem['turnRestrictions'];
}

const MAX_GESTURE_TARGETS = 256;

function renderInputs(system: TransitSystem): RenderInputReferences {
  return {
    ways: system.ways,
    services: system.services,
    stations: system.stations,
    facilities: system.facilities,
    groups: system.groups,
    nodes: system.nodes,
    namedWays: system.namedWays,
    turnRestrictions: system.turnRestrictions,
  };
}

function unexpectedInputChange(
  before: RenderInputReferences,
  after: TransitSystem,
  affected: GestureAffectedEntities,
  allowServiceChange: boolean,
  allowNewWayDiscovery: boolean,
): boolean {
  if (after.services !== before.services) {
    if (!allowServiceChange) return true;
    if (
      after.services.length !== before.services.length &&
      after.services.length !== before.services.length + 1
    )
      return true;
  }
  if (after.namedWays !== before.namedWays || after.turnRestrictions !== before.turnRestrictions)
    return true;
  if (after.ways !== before.ways && affected.wayIds.length === 0 && !allowNewWayDiscovery)
    return true;
  if (
    after.ways !== before.ways &&
    affected.wayIds.length > 0 &&
    after.ways.length !== before.ways.length &&
    !(allowServiceChange && after.ways.length === before.ways.length + 1)
  )
    return true;
  if (
    after.stations !== before.stations &&
    affected.stationIds.length === 0 &&
    // updateWayPoints intentionally maps the station array even when the
    // targeted way has no anchors. Expansion already found every anchored
    // station once; an unchanged cardinality is therefore the expected
    // reference-only result, while an import adding/removing stations aborts.
    !(affected.wayIds.length > 0 && after.stations.length === before.stations.length)
  )
    return true;
  if (after.stations !== before.stations && after.stations.length !== before.stations.length)
    return true;
  if (after.facilities !== before.facilities && affected.facilityIds.length === 0) return true;
  if (
    after.facilities !== before.facilities &&
    after.facilities.length !== before.facilities.length
  )
    return true;
  if (after.groups !== before.groups && affected.groupIds.length === 0) return true;
  if (after.groups !== before.groups && after.groups.length !== before.groups.length) return true;
  if (after.nodes !== before.nodes && affected.nodeIds.length === 0) return true;
  if (after.nodes !== before.nodes && after.nodes.length !== before.nodes.length) return true;
  return totalTargets(affected) > MAX_GESTURE_TARGETS;
}

function totalTargets(affected: GestureAffectedEntities): number {
  return (
    affected.wayIds.length +
    affected.stationIds.length +
    affected.facilityIds.length +
    affected.groupIds.length +
    affected.nodeIds.length
  );
}

function expandTargets(
  system: TransitSystem,
  targets: EditGestureTargets,
): GestureAffectedEntities {
  const wayIds = orderedSet(targets.wayIds);
  const nodeIds = orderedSet(targets.nodeIds);
  for (const target of targets.wayPoints ?? []) {
    wayIds.add(target.wayId);
    const node = system.nodes.find((candidate) =>
      candidate.refs.some(
        (ref) => ref.wayId === target.wayId && ref.pointIndex === target.pointIndex,
      ),
    );
    if (!node) continue;
    nodeIds.add(node.id);
    for (const ref of node.refs) wayIds.add(ref.wayId);
  }

  const stationIds = orderedSet(targets.stationIds);
  if (wayIds.size > 0) {
    for (const station of system.stations) {
      if (station.anchors.some((anchor) => wayIds.has(anchor.wayId))) stationIds.add(station.id);
    }
  }

  return {
    wayIds: [...wayIds],
    stationIds: [...stationIds],
    facilityIds: [...orderedSet(targets.facilityIds)],
    groupIds: [...orderedSet(targets.groupIds)],
    nodeIds: [...nodeIds],
  };
}

function orderedSet(values: string[] | undefined): Set<string> {
  return new Set(values ?? []);
}

function mergeAffected(
  before: GestureAffectedEntities,
  after: GestureAffectedEntities,
): GestureAffectedEntities {
  return {
    wayIds: [...new Set([...before.wayIds, ...after.wayIds])],
    stationIds: [...new Set([...before.stationIds, ...after.stationIds])],
    facilityIds: [...new Set([...before.facilityIds, ...after.facilityIds])],
    groupIds: [...new Set([...before.groupIds, ...after.groupIds])],
    nodeIds: [...new Set([...before.nodeIds, ...after.nodeIds])],
  };
}

function copyAffected(affected: GestureAffectedEntities): GestureAffectedEntities {
  return {
    wayIds: [...affected.wayIds],
    stationIds: [...affected.stationIds],
    facilityIds: [...affected.facilityIds],
    groupIds: [...affected.groupIds],
    nodeIds: [...affected.nodeIds],
  };
}

function createLocators(system: TransitSystem, affected: GestureAffectedEntities): GestureLocators {
  return {
    ways: createEntityLocator(system.ways, affected.wayIds),
    stations: createEntityLocator(system.stations, affected.stationIds),
    facilities: createEntityLocator(system.facilities, affected.facilityIds),
    groups: createEntityLocator(system.groups, affected.groupIds),
    nodes: createEntityLocator(system.nodes, affected.nodeIds),
  };
}

function createEntityLocator<T extends Entity>(entities: T[], ids: string[]): EntityLocator<T> {
  const wanted = new Set(ids);
  const indexes = new Map<string, number>();
  if (wanted.size > 0) {
    entities.forEach((entity, index) => {
      if (wanted.has(entity.id)) indexes.set(entity.id, index);
    });
  }
  return {
    resolve(current, counts) {
      const resolved: T[] = [];
      for (const id of ids) {
        counts.entityComparisonCount++;
        const index = indexes.get(id);
        const atIndex = index === undefined ? undefined : current[index];
        if (atIndex?.id === id) {
          resolved.push(atIndex);
          continue;
        }
        // Insert/delete operations can shift indexes. This is a bounded
        // fallback over one target; ordinary drag frames stay O(targets).
        const found = current.find((entity) => entity.id === id);
        if (found) resolved.push(found);
      }
      return resolved;
    },
  };
}

function properties(kind: string, ownerId: string): GeoJsonProperties {
  return { kind, ownerId };
}

function projectWay(way: Way): Array<Feature<LineString | Point>> {
  const features: Array<Feature<LineString | Point>> = [];
  const path = resolveWayPath(way);
  if (path.length >= 2) {
    features.push({
      type: 'Feature',
      properties: properties('way', way.id),
      geometry: { type: 'LineString', coordinates: path },
    });
  }
  features.push(...controlPointFeatures(way.id, way.points));
  return features;
}

function projectStation(station: Station): Array<Feature<Point | Polygon>> {
  const features: Array<Feature<Point | Polygon>> = [
    {
      type: 'Feature',
      properties: properties('station', station.id),
      geometry: { type: 'Point', coordinates: station.coord },
    },
  ];
  if (station.footprint) {
    features.push(polygonFeature('footprint', station.id, station.footprint));
    features.push(...controlPointFeatures(station.id, station.footprint));
  }
  for (const platform of station.platforms ?? []) {
    features.push(polygonFeature('platform', station.id, platform.points));
    features.push(...controlPointFeatures(station.id, platform.points));
  }
  return features;
}

function projectFacility(facility: Facility): Array<Feature<Point | Polygon>> {
  if (Array.isArray(facility.geometry[0])) {
    const points = facility.geometry as LngLat[];
    return [
      polygonFeature('facility', facility.id, points),
      ...controlPointFeatures(facility.id, points),
    ];
  }
  return [
    {
      type: 'Feature',
      properties: properties('facility', facility.id),
      geometry: { type: 'Point', coordinates: facility.geometry as LngLat },
    },
  ];
}

function projectGroup(group: Group): Array<Feature<Point | Polygon>> {
  if (!group.footprint) return [];
  const polygon = polygonFeature('footprint', group.id, group.footprint);
  polygon.properties = { ...polygon.properties, color: group.color };
  return [polygon, ...controlPointFeatures(group.id, group.footprint)];
}

function projectNode(node: Node): Feature<Point> {
  return {
    type: 'Feature',
    properties: properties('junction', node.id),
    geometry: { type: 'Point', coordinates: node.coord },
  };
}

function controlPointFeatures(ownerId: string, points: LngLat[]): Feature<Point>[] {
  return points.map((point) => ({
    type: 'Feature',
    properties: properties('control', ownerId),
    geometry: { type: 'Point', coordinates: point },
  }));
}

function polygonFeature(kind: string, ownerId: string, points: LngLat[]): Feature<Polygon> {
  const first = points[0];
  const last = points.at(-1);
  const closed =
    first && last && (first[0] !== last[0] || first[1] !== last[1]) ? [...points, first] : points;
  return {
    type: 'Feature',
    properties: properties(kind, ownerId),
    geometry: { type: 'Polygon', coordinates: [closed] },
  };
}
