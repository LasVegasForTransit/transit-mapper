import { describe, expect, it } from 'vitest';
import { junctionGeometry } from '../../src/geometry/junctions';
import {
  junctionControlledApproaches,
  junctionCrosswalks,
  junctionStopBars,
} from '../../src/geometry/junction-markings';
import type { LngLat, Node } from '../../src/model/system';
import { aRoad } from '../support/fixtures.test';

function controlledJunction(): {
  readonly node: Node;
  readonly waysById: Map<string, ReturnType<typeof aRoad>>;
} {
  const coord: LngLat = [-115.16, 36.14];
  const west = aRoad('west', [[-115.2, 36.14], coord]);
  const east = aRoad('east', [coord, [-115.12, 36.14]]);
  const south = aRoad('south', [[-115.16, 36.1], coord]);
  const north = aRoad('north', [coord, [-115.16, 36.18]]);
  return {
    node: {
      id: 'junction',
      coord,
      control: 'signal',
      refs: [
        { wayId: west.id, pointIndex: 1 },
        { wayId: east.id, pointIndex: 0 },
        { wayId: south.id, pointIndex: 1 },
        { wayId: north.id, pointIndex: 0 },
      ],
    },
    waysById: new Map([west, east, south, north].map((way) => [way.id, way])),
  };
}

describe('junction markings', () => {
  it('places zebra stripes on every approach to a signal-controlled junction', () => {
    const { node, waysById } = controlledJunction();
    const geometry = junctionGeometry(node, waysById);

    expect(geometry).not.toBeNull();
    if (!geometry) return;
    const crosswalks = junctionCrosswalks(node, geometry);

    expect(crosswalks).toHaveLength(4);
    expect(crosswalks.map((crosswalk) => crosswalk.wayId).sort()).toEqual([
      'east',
      'north',
      'south',
      'west',
    ]);
    expect(crosswalks.every((crosswalk) => crosswalk.stripes.length >= 3)).toBe(true);
    expect(
      crosswalks.every((crosswalk) =>
        crosswalk.stripes.every(([start, end]) => start[0] !== end[0] || start[1] !== end[1]),
      ),
    ).toBe(true);
  });

  it('does not invent pedestrian paint at an uncontrolled junction', () => {
    const { node, waysById } = controlledJunction();
    const geometry = junctionGeometry({ ...node, control: undefined }, waysById);

    expect(geometry).not.toBeNull();
    if (!geometry) return;
    expect(junctionCrosswalks({ ...node, control: undefined }, geometry)).toEqual([]);
  });

  it('renders a per-approach stop control without claiming the whole junction is controlled', () => {
    const { node, waysById } = controlledJunction();
    const uncontrolled = { ...node, control: undefined };
    const geometry = junctionGeometry(uncontrolled, waysById);

    expect(geometry).not.toBeNull();
    if (!geometry) return;
    const approachControls = { 'east:start': { control: 'stop' as const } };
    const approaches = junctionControlledApproaches(uncontrolled, geometry, approachControls);
    const crosswalks = junctionCrosswalks(uncontrolled, geometry, approachControls);
    const bars = junctionStopBars(uncontrolled, geometry, approachControls);

    expect(approaches).toMatchObject([
      { control: 'stop', explicit: true, arm: { wayId: 'east', end: 'start' } },
    ]);
    expect(crosswalks.map(({ wayId }) => wayId)).toEqual(['east']);
    expect(bars.map(({ wayId }) => wayId)).toEqual(['east']);
  });

  it('places one solid stop bar beyond each controlled crosswalk', () => {
    const { node, waysById } = controlledJunction();
    const geometry = junctionGeometry(node, waysById);

    expect(geometry).not.toBeNull();
    if (!geometry) return;
    const bars = junctionStopBars(node, geometry);

    expect(bars).toHaveLength(4);
    expect(bars.map((bar) => bar.wayId).sort()).toEqual(['east', 'north', 'south', 'west']);
    expect(bars.every(({ path }) => path[0][0] !== path[1][0] || path[0][1] !== path[1][1])).toBe(
      true,
    );
  });
});
