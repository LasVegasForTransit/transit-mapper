/**
 * Paint geometry that belongs inside a resolved junction footprint.
 *
 * The model records a traffic control, not arbitrary road paint. We draw
 * crosswalks only where that control makes the pedestrian crossing explicit
 * (`signal` or `stop`); treating every geometric intersection as a zebra
 * crossing would invent street design a person did not author.
 */
import { offsetMeters } from '../model/geo';
import { armRefKey, getComponent, type ComponentMap } from '../model/components';
import type { ApproachControl, LngLat, Node, NodeControl } from '../model/system';
import type { JunctionArm, JunctionGeometry } from './junctions';

export interface JunctionCrosswalk {
  readonly nodeId: string;
  readonly wayId: string;
  readonly end: JunctionArm['end'];
  /** Parallel two-point paint strokes, ordered from the junction outward. */
  readonly stripes: [LngLat, LngLat][];
}

export interface JunctionStopBar {
  readonly nodeId: string;
  readonly wayId: string;
  readonly end: JunctionArm['end'];
  /** A solid line across the approach, immediately behind its crosswalk. */
  readonly path: [LngLat, LngLat];
}

/** One visible control decision per physical arm. Whole-junction controls
 * remain the fallback, while an ApproachControl is deliberately explicit so
 * a renderer can distinguish a signal that governs every arm from one that
 * governs only the minor street. */
export interface JunctionControlledApproach {
  readonly arm: JunctionArm;
  readonly control: Exclude<NodeControl, 'uncontrolled'>;
  readonly explicit: boolean;
  /** A marker sits just beyond the junction footprint, not over its centre. */
  readonly coord: LngLat;
}

const CROSSWALK_DEPTH_M = 3;
const CROSSWALK_STRIPE_SPACING_M = 0.75;
const CROSSWALK_EDGE_CLEARANCE_M = 1.2;
const STOP_BAR_CLEARANCE_M = 0.8;

/** Derive pedestrian stripes immediately outside each controlled approach.
 * `JunctionGeometry` already resolved arm tangents and trim distances, so the
 * markings remain perpendicular to the actual carriageway after curves or
 * cross-section changes. */
export function junctionCrosswalks(
  node: Node,
  geometry: JunctionGeometry,
  approachControls: ComponentMap<ApproachControl> = {},
): readonly JunctionCrosswalk[] {
  return junctionControlledApproaches(node, geometry, approachControls)
    .filter(({ control }) => control === 'signal' || control === 'stop')
    .map(({ arm }) => crosswalkForArm(geometry, arm));
}

/** Stop bars share the crosswalk's resolved approach frame, but sit farther
 * from the junction so drivers encounter the pedestrian crossing first. */
export function junctionStopBars(
  node: Node,
  geometry: JunctionGeometry,
  approachControls: ComponentMap<ApproachControl> = {},
): readonly JunctionStopBar[] {
  return junctionControlledApproaches(node, geometry, approachControls)
    .filter(({ control }) => control === 'signal' || control === 'stop')
    .map(({ arm }) => stopBarForArm(geometry, arm));
}

export function junctionControlledApproaches(
  node: Node,
  geometry: JunctionGeometry,
  approachControls: ComponentMap<ApproachControl> = {},
): readonly JunctionControlledApproach[] {
  return geometry.arms.flatMap((arm) => {
    const override = getComponent(approachControls, armRefKey(arm.wayId, arm.end));
    const control = override?.control ?? node.control;
    if (!control || control === 'uncontrolled') return [];
    const distance = Math.max(arm.trimM, 0.5) + CROSSWALK_EDGE_CLEARANCE_M;
    return [
      {
        arm,
        control,
        explicit: Boolean(override),
        coord: offsetMeters(geometry.coord, arm.dir[0] * distance, arm.dir[1] * distance),
      },
    ];
  });
}

interface ApproachPaintFrame {
  readonly normal: readonly [number, number];
  readonly crosswalkCenterDistance: number;
  readonly halfSpan: number;
}

function approachPaintFrame(arm: JunctionArm): ApproachPaintFrame {
  return {
    normal: [-arm.dir[1], arm.dir[0]],
    crosswalkCenterDistance: Math.max(arm.trimM, 0.5) + CROSSWALK_EDGE_CLEARANCE_M,
    halfSpan: Math.max(1.5, arm.halfWidthM * 0.85),
  };
}

function crosswalkForArm(geometry: JunctionGeometry, arm: JunctionArm): JunctionCrosswalk {
  const frame = approachPaintFrame(arm);
  const stripeCount = Math.max(3, Math.floor(CROSSWALK_DEPTH_M / CROSSWALK_STRIPE_SPACING_M));
  const firstOffset = -((stripeCount - 1) * CROSSWALK_STRIPE_SPACING_M) / 2;
  const stripes: [LngLat, LngLat][] = [];

  for (let index = 0; index < stripeCount; index += 1) {
    const distance =
      frame.crosswalkCenterDistance + firstOffset + index * CROSSWALK_STRIPE_SPACING_M;
    const center = offsetMeters(geometry.coord, arm.dir[0] * distance, arm.dir[1] * distance);
    stripes.push([
      offsetMeters(center, frame.normal[0] * frame.halfSpan, frame.normal[1] * frame.halfSpan),
      offsetMeters(center, -frame.normal[0] * frame.halfSpan, -frame.normal[1] * frame.halfSpan),
    ]);
  }
  return { nodeId: geometry.nodeId, wayId: arm.wayId, end: arm.end, stripes };
}

function stopBarForArm(geometry: JunctionGeometry, arm: JunctionArm): JunctionStopBar {
  const frame = approachPaintFrame(arm);
  const distance = frame.crosswalkCenterDistance + CROSSWALK_DEPTH_M / 2 + STOP_BAR_CLEARANCE_M;
  const center = offsetMeters(geometry.coord, arm.dir[0] * distance, arm.dir[1] * distance);
  return {
    nodeId: geometry.nodeId,
    wayId: arm.wayId,
    end: arm.end,
    path: [
      offsetMeters(center, frame.normal[0] * frame.halfSpan, frame.normal[1] * frame.halfSpan),
      offsetMeters(center, -frame.normal[0] * frame.halfSpan, -frame.normal[1] * frame.halfSpan),
    ],
  };
}
