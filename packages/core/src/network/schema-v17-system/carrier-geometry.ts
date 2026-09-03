import type { CurvedPathSource } from '../../model/geo/wayPath';
import { resolveWayPath } from '../../model/geo/wayPath';
import type { Alignment, TransitSystem, Way } from '../../transit/authored-system';
import type { CarrierGeometrySource } from '../carrier-geometry';

/** v16 named a curve radius `radiusM` and v17 names it `radiusMeters`. The
 * migration renames it and changes no unit, so this is a rename here too —
 * but a Way passed through unmapped would carry an undefined radius and draw
 * a curve as a straight chord, which nothing downstream would report. */
function pathSourceFor(alignment: Alignment): CurvedPathSource {
  return {
    points: alignment.points,
    geometry: alignment.geometry,
    ...(alignment.curveControls
      ? {
          curveControls: alignment.curveControls.map((control) => ({
            pointIndex: control.pointIndex,
            radiusM: control.radiusMeters,
          })),
        }
      : {}),
  };
}

/** The path resolver caches on source identity, so one mapped source per
 * Alignment is what keeps that cache useful across projections. */
const pathSources = new WeakMap<Alignment, CurvedPathSource>();

function cachedPathSource(alignment: Alignment): CurvedPathSource {
  const existing = pathSources.get(alignment);
  if (existing) return existing;
  const source = pathSourceFor(alignment);
  pathSources.set(alignment, source);
  return source;
}

export function alignmentPath(alignment: Alignment): readonly [number, number][] {
  return resolveWayPath(cachedPathSource(alignment));
}

export interface AlignmentIndex {
  get(alignmentId: string): Alignment | undefined;
}

export function alignmentIndex(system: TransitSystem): AlignmentIndex {
  const byId = new Map(system.alignments.map((alignment) => [alignment.id, alignment]));
  return { get: (alignmentId) => byId.get(alignmentId) };
}

/** A v17 Way claims an Alignment rather than carrying points, so geometry and
 * infrastructure identity are separate lookups here where v16 had one object. */
export function wayGeometrySource(
  way: Way,
  alignments: AlignmentIndex,
  laneId?: string,
): CarrierGeometrySource | undefined {
  const alignment = alignments.get(way.alignmentId);
  if (!alignment) return undefined;
  const source = cachedPathSource(alignment);
  return {
    carrier:
      laneId === undefined ? { kind: 'way', id: way.id } : { kind: 'way', id: way.id, laneId },
    alignmentId: way.alignmentId,
    alignmentExtent: [0, 1],
    points: resolveWayPath(source),
    geometry: alignment.geometry,
  };
}

export function alignmentGeometrySource(alignment: Alignment): CarrierGeometrySource {
  return {
    carrier: { kind: 'alignment', id: alignment.id },
    alignmentId: alignment.id,
    alignmentExtent: [0, 1],
    points: alignmentPath(alignment),
    geometry: alignment.geometry,
  };
}
