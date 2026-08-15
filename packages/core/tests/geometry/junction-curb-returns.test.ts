import { describe, expect, it } from 'vitest';
import { junctionGeometry } from '../../src/geometry/junctions';
import { metersFromOrigin } from '../../src/model/geo';
import type { LngLat, Node } from '../../src/model/system';
import { aRoad } from '../support/fixtures.test';

function fourWayJunction() {
  const coord: LngLat = [-115.16, 36.14];
  const west = aRoad('west', [[-115.2, 36.14], coord]);
  const east = aRoad('east', [coord, [-115.12, 36.14]]);
  const south = aRoad('south', [[-115.16, 36.1], coord]);
  const north = aRoad('north', [coord, [-115.16, 36.18]]);
  const node: Node = {
    id: 'four-way',
    coord,
    refs: [
      { wayId: west.id, pointIndex: 1 },
      { wayId: east.id, pointIndex: 0 },
      { wayId: south.id, pointIndex: 1 },
      { wayId: north.id, pointIndex: 0 },
    ],
  };
  return {
    coord,
    node,
    waysById: new Map([west, east, south, north].map((way) => [way.id, way])),
  };
}

describe('junction curb returns', () => {
  it('rounds each corner between two trimmed approach edges', () => {
    const { coord, node, waysById } = fourWayJunction();
    const geometry = junctionGeometry(node, waysById);

    expect(geometry).not.toBeNull();
    if (!geometry) return;

    // The former chamfer had exactly two corners per arm. A four-arm junction
    // now carries three interior samples for every curb return as well.
    expect(geometry.polygon).toHaveLength(20);

    const northeast = geometry.polygon
      .map((point) => metersFromOrigin(coord, point))
      .filter(([x, y]) => x > 0 && y > 0);

    expect(northeast).toHaveLength(5);
    expect(northeast[1][0]).toBeGreaterThan(northeast[0][0]);
    expect(northeast[1][1]).toBeGreaterThan(northeast[2][1]);
    expect(northeast[3][0]).toBeLessThan(northeast[4][0]);
  });
});
