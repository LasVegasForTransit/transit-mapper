import { haversineMeters, nearestInsertionPoint } from './geo';
import { shortId } from './ids';
import { reanchorStopsOnWay } from './stop-reanchoring';
import {
  curveControlsAfterPointDeletion,
  curveControlsAfterPointInsertion,
} from './curve-controls';
import type { CurveControl, LngLat, Node, TransitSystem } from './system';

export type CreateWayPointEditId = () => string;

export interface WayPointJoin {
  wayId: string;
  index: number;
  targetWayId: string;
  coord: LngLat;
}

function sameCoord(left: LngLat, right: LngLat): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function withWayPoints(
  system: TransitSystem,
  wayId: string,
  points: LngLat[],
  curveControls?: CurveControl[],
): TransitSystem {
  const index = system.ways.findIndex((way) => way.id === wayId);
  if (index < 0 || points === system.ways[index].points) return system;
  const ways = [...system.ways];
  ways[index] =
    curveControls === undefined
      ? { ...ways[index], points }
      : { ...ways[index], points, curveControls };
  const next = { ...system, ways };
  const stops = reanchorStopsOnWay(next, wayId);
  return { ...next, stops };
}

function withInsertedPoint(way: TransitSystem['ways'][number], index: number, coord: LngLat) {
  const curveControls = way.curveControls
    ? curveControlsAfterPointInsertion(way.curveControls, index)
    : undefined;
  return {
    ...way,
    points: [...way.points.slice(0, index), coord, ...way.points.slice(index)],
    ...(curveControls ? { curveControls } : {}),
  };
}

function shiftRefsForInsert(nodes: Node[], wayId: string, index: number): Node[] {
  return nodes.map((node) => ({
    ...node,
    refs: node.refs.map((ref) =>
      ref.wayId === wayId && ref.pointIndex >= index
        ? { ...ref, pointIndex: ref.pointIndex + 1 }
        : ref,
    ),
  }));
}

function shiftRefsForDelete(nodes: Node[], wayId: string, index: number): Node[] {
  return nodes
    .map((node) => ({
      ...node,
      refs: node.refs
        .filter((ref) => !(ref.wayId === wayId && ref.pointIndex === index))
        .map((ref) =>
          ref.wayId === wayId && ref.pointIndex > index
            ? { ...ref, pointIndex: ref.pointIndex - 1 }
            : ref,
        ),
    }))
    .filter((node) => node.refs.length >= 2);
}

/** Appends one control point and remeasures stops riding the way. */
export function appendWayPoint(system: TransitSystem, wayId: string, coord: LngLat): TransitSystem {
  const way = system.ways.find((candidate) => candidate.id === wayId);
  return way ? withWayPoints(system, wayId, [...way.points, coord]) : system;
}

/** Inserts one control point while keeping every junction ref aligned. */
export function insertWayPoint(
  system: TransitSystem,
  wayId: string,
  index: number,
  coord: LngLat,
): TransitSystem {
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way || index < 0 || index > way.points.length) return system;
  const inserted = withInsertedPoint(way, index, coord);
  const next = withWayPoints(system, wayId, inserted.points, inserted.curveControls);
  return { ...next, nodes: shiftRefsForInsert(next.nodes, wayId, index) };
}

/** Moves a point and every coincident arm when the point belongs to a junction. */
export function moveWayPoint(
  system: TransitSystem,
  wayId: string,
  index: number,
  coord: LngLat,
): TransitSystem {
  const way = system.ways.find((candidate) => candidate.id === wayId);
  const point = way?.points[index];
  if (!way || !point || sameCoord(point, coord)) return system;
  const node = system.nodes.find((candidate) =>
    candidate.refs.some((ref) => ref.wayId === wayId && ref.pointIndex === index),
  );
  if (!node) {
    return withWayPoints(
      system,
      wayId,
      way.points.map((candidate, candidateIndex) => (candidateIndex === index ? coord : candidate)),
    );
  }

  const refs = new Map(node.refs.map((ref) => [`${ref.wayId}:${ref.pointIndex}`, ref]));
  const ways = system.ways.map((candidate) => {
    const points = candidate.points.map((candidatePoint, candidateIndex) =>
      refs.has(`${candidate.id}:${candidateIndex}`) ? coord : candidatePoint,
    );
    return points.some(
      (candidatePoint, candidateIndex) => candidatePoint !== candidate.points[candidateIndex],
    )
      ? { ...candidate, points }
      : candidate;
  });
  const nodes = system.nodes.map((candidate) =>
    candidate.id === node.id ? { ...candidate, coord } : candidate,
  );
  let next: TransitSystem = { ...system, ways, nodes };
  for (const refWayId of new Set(node.refs.map((ref) => ref.wayId))) {
    next = { ...next, stops: reanchorStopsOnWay(next, refWayId) };
  }
  return next;
}

/** Deletes a control point without allowing an unrenderable one-point way. */
export function deleteWayPoint(system: TransitSystem, wayId: string, index: number): TransitSystem {
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way || way.points.length <= 2 || !way.points[index]) return system;
  const next = withWayPoints(
    system,
    wayId,
    way.points.filter((_, candidateIndex) => candidateIndex !== index),
    way.curveControls ? curveControlsAfterPointDeletion(way.curveControls, index) : undefined,
  );
  return { ...next, nodes: shiftRefsForDelete(next.nodes, wayId, index) };
}

/** Joins one way point to a real point and shared node on another way. */
export function joinWayPointToWay(
  system: TransitSystem,
  join: WayPointJoin,
  createId: CreateWayPointEditId = shortId,
): TransitSystem {
  const { wayId, index, targetWayId, coord } = join;
  if (wayId === targetWayId) return system;
  const way = system.ways.find((candidate) => candidate.id === wayId);
  const target = system.ways.find((candidate) => candidate.id === targetWayId);
  if (!way?.points[index] || !target) return system;

  let targetIndex = target.points.findIndex((point) => haversineMeters(point, coord) <= 0.75);
  let exactCoord = coord;
  let ways = system.ways;
  let nodes = system.nodes;
  if (targetIndex < 0) {
    const insertion = nearestInsertionPoint(target.points, coord);
    if (!insertion) return system;
    targetIndex = insertion.index;
    exactCoord = insertion.coord;
    ways = ways.map((candidate) =>
      candidate.id === targetWayId
        ? withInsertedPoint(candidate, targetIndex, exactCoord)
        : candidate,
    );
    nodes = shiftRefsForInsert(nodes, targetWayId, targetIndex);
  } else {
    exactCoord = target.points[targetIndex];
  }

  const pointChanged = !sameCoord(way.points[index], exactCoord);
  if (pointChanged) {
    ways = ways.map((candidate) =>
      candidate.id === wayId
        ? {
            ...candidate,
            points: candidate.points.map((point, candidateIndex) =>
              candidateIndex === index ? exactCoord : point,
            ),
          }
        : candidate,
    );
  }

  const existing = nodes.find((node) =>
    node.refs.some((ref) => ref.wayId === targetWayId && ref.pointIndex === targetIndex),
  );
  const alreadyLinked = existing?.refs.some(
    (ref) => ref.wayId === wayId && ref.pointIndex === index,
  );
  if (existing && !alreadyLinked) {
    nodes = nodes.map((node) =>
      node.id === existing.id
        ? { ...node, refs: [...node.refs, { wayId, pointIndex: index }] }
        : node,
    );
  } else if (!existing) {
    nodes = [
      ...nodes,
      {
        id: createId(),
        coord: exactCoord,
        refs: [
          { wayId: targetWayId, pointIndex: targetIndex },
          { wayId, pointIndex: index },
        ],
      },
    ];
  }
  if (ways === system.ways && nodes === system.nodes) return system;
  let next: TransitSystem = { ...system, ways, nodes };
  next = { ...next, stops: reanchorStopsOnWay(next, targetWayId) };
  return { ...next, stops: reanchorStopsOnWay(next, wayId) };
}

/** Records a coincident first/last point as a routable loop junction. */
export function closeWayLoop(
  system: TransitSystem,
  wayId: string,
  createId: CreateWayPointEditId = shortId,
): TransitSystem {
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way || way.points.length < 2) return system;
  const lastIndex = way.points.length - 1;
  if (!sameCoord(way.points[0], way.points[lastIndex])) return system;
  const existing = system.nodes.find((node) =>
    node.refs.some((ref) => ref.wayId === wayId && ref.pointIndex === 0),
  );
  if (existing?.refs.some((ref) => ref.wayId === wayId && ref.pointIndex === lastIndex)) {
    return system;
  }
  const nodes = existing
    ? system.nodes.map((node) =>
        node.id === existing.id
          ? { ...node, refs: [...node.refs, { wayId, pointIndex: lastIndex }] }
          : node,
      )
    : [
        ...system.nodes,
        {
          id: createId(),
          coord: way.points[0],
          refs: [
            { wayId, pointIndex: 0 },
            { wayId, pointIndex: lastIndex },
          ],
        },
      ];
  return { ...system, nodes };
}

/** Removes every intermediate point that is not a junction. */
export function straightenWay(system: TransitSystem, wayId: string): TransitSystem {
  const way = system.ways.find((candidate) => candidate.id === wayId);
  if (!way || way.points.length <= 2) return system;
  const junctionIndexes = new Set(
    system.nodes.flatMap((node) =>
      node.refs.filter((ref) => ref.wayId === wayId).map((ref) => ref.pointIndex),
    ),
  );
  const removed = new Set(
    way.points
      .map((_, index) => index)
      .filter((index) => index > 0 && index < way.points.length - 1 && !junctionIndexes.has(index)),
  );
  if (removed.size === 0) return system;
  const points = way.points.filter((_, index) => !removed.has(index));
  const next = withWayPoints(system, wayId, points);
  const nodes = next.nodes.map((node) => ({
    ...node,
    refs: node.refs.map((ref) => {
      if (ref.wayId !== wayId) return ref;
      const shift = [...removed].filter((index) => index < ref.pointIndex).length;
      return shift === 0 ? ref : { ...ref, pointIndex: ref.pointIndex - shift };
    }),
  }));
  return { ...next, nodes };
}
