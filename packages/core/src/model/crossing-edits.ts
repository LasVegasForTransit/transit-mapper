import { isMajorRoad, wayType } from './catalog';
import {
  candidateWayIdsAlong,
  haversineMeters,
  nearestOnPath,
  pathLengthMeters,
  resolveWayPath,
} from './geo';
import { shortId } from './ids';
import { profileWidthM } from './profile';
import type { LngLat, NodeControl, TransitSystem, Way } from './system';
import { wayCrossings } from './validate';
import { insertWayPoint, joinWayPointToWay } from './way-point-edits';
import { splitWayAtIndex } from './way-split-edits';
import { splitWayAtIndexWithResult, splitWayAtPositionWithResult } from './way-split-results';

const JOIN_TOLERANCE_M = 0.75;
const VIADUCT_CLEARANCE_M = 5;
const MIN_VIADUCT_HALF_SPAN_M = 8;
const MIN_STRETCH_T = 1e-3;

export type CreateCrossingId = () => string;

interface JunctionSplice {
  system: TransitSystem;
  newArmId: string;
}

interface JunctionSpliceRequest {
  wayId: string;
  index: number;
  coord: LngLat;
  crossing: Way;
  control?: NodeControl;
}

function spliceJunction(
  system: TransitSystem,
  request: JunctionSpliceRequest,
  createId: CreateCrossingId,
): JunctionSplice | null {
  const { wayId, index, coord, crossing, control } = request;
  let next = insertWayPoint(system, wayId, index, coord);
  if (next === system) return null;
  next = joinWayPointToWay(next, { wayId, index, targetWayId: crossing.id, coord }, createId);
  if (control) {
    next = {
      ...next,
      nodes: next.nodes.map((node) =>
        node.refs.some((ref) => ref.wayId === wayId && ref.pointIndex === index)
          ? { ...node, control }
          : node,
      ),
    };
  }
  const exact = next.ways.find((way) => way.id === wayId)?.points[index];
  const crossingWay = next.ways.find((way) => way.id === crossing.id);
  if (!exact || !crossingWay) return null;
  const crossingIndex = crossingWay.points.findIndex(
    (point) => haversineMeters(point, exact) <= JOIN_TOLERANCE_M,
  );
  const split = splitWayAtIndexWithResult(next, wayId, index, createId);
  if (!split) return null;
  next = split.system;
  if (crossingIndex > 0 && crossingIndex < crossingWay.points.length - 1) {
    next = splitWayAtIndex(next, crossing.id, crossingIndex, createId);
  }
  return { system: next, newArmId: split.newWayId };
}

interface ElevatedPieces {
  system: TransitSystem;
  pieceIds: string[];
}

interface ElevationRequest {
  wayId: string;
  crossingCoord: LngLat;
  roadWidthM: number;
}

function elevatedAcrossRoad(
  system: TransitSystem,
  request: ElevationRequest,
  createId: CreateCrossingId,
): ElevatedPieces | null {
  const { wayId, crossingCoord, roadWidthM } = request;
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way) return null;
  const path = resolveWayPath(way);
  const total = pathLengthMeters(path);
  const crossing = path.length >= 2 ? nearestOnPath(path, crossingCoord) : null;
  if (!crossing || total <= 0) return null;
  const halfSpanM = Math.max(roadWidthM / 2 + VIADUCT_CLEARANCE_M, MIN_VIADUCT_HALF_SPAN_M);
  const low = Math.max(0, crossing.t - halfSpanM / total);
  const high = Math.min(1, crossing.t + halfSpanM / total);
  if (high - low < MIN_STRETCH_T) return null;

  const highSplit = splitWayAtPositionWithResult(system, wayId, high, createId);
  let next = highSplit?.system ?? system;
  const lowSplit = splitWayAtPositionWithResult(next, wayId, low, createId);
  next = lowSplit?.system ?? next;
  const elevatedId = lowSplit?.newWayId ?? wayId;
  next = {
    ...next,
    ways: next.ways.map((candidate) =>
      candidate.id === elevatedId ? { ...candidate, grade: 'elevated' } : candidate,
    ),
  };
  return {
    system: next,
    pieceIds: [lowSplit ? wayId : null, elevatedId, highSplit?.newWayId ?? null].filter(
      (id): id is string => id !== null,
    ),
  };
}

interface CrossingChange {
  system: TransitSystem;
  queuedIds: string[];
}

function resolveCrossing(
  system: TransitSystem,
  way: Way,
  crossing: Way,
  createId: CreateCrossingId,
): CrossingChange | null {
  const crossings = wayCrossings(way, crossing);
  if (crossings.length === 0) return null;
  if (crossing.typeId === way.typeId) {
    const first = crossings[0];
    const spliced = spliceJunction(
      system,
      { wayId: way.id, index: first.aIndex, coord: first.coord, crossing },
      createId,
    );
    return spliced ? { system: spliced.system, queuedIds: [way.id, spliced.newArmId] } : null;
  }
  if (wayType(way.typeId).family !== 'guideway' || crossing.typeId !== 'road') return null;
  const first = crossings[0];
  if (isMajorRoad(crossing)) {
    const elevated = elevatedAcrossRoad(
      system,
      {
        wayId: way.id,
        crossingCoord: first.coord,
        roadWidthM: profileWidthM(crossing.profile),
      },
      createId,
    );
    return elevated ? { system: elevated.system, queuedIds: elevated.pieceIds } : null;
  }
  const spliced = spliceJunction(
    system,
    {
      wayId: way.id,
      index: first.aIndex,
      coord: first.coord,
      crossing,
      control: 'levelCrossing',
    },
    createId,
  );
  return spliced ? { system: spliced.system, queuedIds: [way.id, spliced.newArmId] } : null;
}

/** Resolves every geometric crossing along one way into model topology. */
export function formCrossingJunctions(
  system: TransitSystem,
  wayId: string,
  onlyWithWayId?: string,
  createId: CreateCrossingId = shortId,
): TransitSystem {
  if (!system.ways.some((way) => way.id === wayId)) return system;
  let next = system;
  const queue = [wayId];
  for (let guard = 0; queue.length > 0 && guard < 400; guard++) {
    const currentId = queue.shift();
    const current = next.ways.find((way) => way.id === currentId);
    if (!current || current.points.length < 2) continue;
    const nearby = candidateWayIdsAlong(resolveWayPath(current), next.ways);
    for (const crossing of next.ways) {
      if (
        crossing.id === current.id ||
        crossing.grade !== current.grade ||
        crossing.points.length < 2 ||
        (onlyWithWayId !== undefined && crossing.id !== onlyWithWayId) ||
        !nearby.has(crossing.id)
      ) {
        continue;
      }
      const change = resolveCrossing(next, current, crossing, createId);
      if (!change) continue;
      next = change.system;
      queue.push(...change.queuedIds);
      break;
    }
  }
  return next;
}
