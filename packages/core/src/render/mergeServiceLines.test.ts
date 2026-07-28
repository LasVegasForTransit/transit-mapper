// Regression tests for lines that are conceptually one continuous run but
// render as visibly separate offset copies at a bend — see mergeServiceLines.ts.

import type { Feature, LineString } from 'geojson';
import { describe, expect, it } from 'vitest';
import { mergeAdjacentServiceLines } from './mergeServiceLines';

function line(props: Record<string, unknown>, coords: [number, number][]): Feature<LineString> {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'LineString', coordinates: coords },
  };
}

describe('mergeAdjacentServiceLines', () => {
  it('joins two fragments of the same run that meet at a bend', () => {
    const a = line({ serviceId: 's', offset: 5 }, [
      [0, 0],
      [1, 0],
    ]);
    const b = line({ serviceId: 's', offset: 5 }, [
      [1, 0],
      [1, 1],
    ]);
    const merged = mergeAdjacentServiceLines([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].geometry.coordinates).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });

  it('joins fragments whose shared point is an END on both sides', () => {
    // b's END touches a's END — chaining them needs one fragment read
    // backwards, unlike the plain end-touches-start case above. The result
    // must still be ONE unbroken line through all three points; which
    // direction it reads is not something rendering cares about, since a
    // stitched feature's `offset` is one constant value for the whole thing
    // (see mergeKey) rather than a value that could disagree with itself
    // fragment-to-fragment.
    const a = line({ serviceId: 's', offset: -5 }, [
      [0, 0],
      [1, 0],
    ]);
    const b = line({ serviceId: 's', offset: -5 }, [
      [2, 1],
      [1, 0],
    ]);
    const merged = mergeAdjacentServiceLines([b, a]);
    expect(merged).toHaveLength(1);
    const coords = merged[0].geometry.coordinates;
    const forward = [
      [0, 0],
      [1, 0],
      [2, 1],
    ];
    expect([coords, [...coords].reverse()]).toContainEqual(forward);
  });

  it('chains three or more fragments of the same run into one line', () => {
    const legs = [
      line({ serviceId: 's', offset: 0 }, [
        [0, 0],
        [1, 0],
      ]),
      line({ serviceId: 's', offset: 0 }, [
        [1, 0],
        [1, 1],
      ]),
      line({ serviceId: 's', offset: 0 }, [
        [1, 1],
        [2, 1],
      ]),
    ];
    const merged = mergeAdjacentServiceLines(legs);
    expect(merged).toHaveLength(1);
    expect(merged[0].geometry.coordinates).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ]);
  });

  it('never joins fragments of two different services', () => {
    const a = line({ serviceId: 'red', offset: 0 }, [
      [0, 0],
      [1, 0],
    ]);
    const b = line({ serviceId: 'blue', offset: 0 }, [
      [1, 0],
      [1, 1],
    ]);
    const merged = mergeAdjacentServiceLines([a, b]);
    expect(merged).toHaveLength(2);
  });

  it('never joins the same service at a different offset (different bundle slot)', () => {
    const a = line({ serviceId: 's', offset: 5 }, [
      [0, 0],
      [1, 0],
    ]);
    const b = line({ serviceId: 's', offset: -5 }, [
      [1, 0],
      [1, 1],
    ]);
    const merged = mergeAdjacentServiceLines([a, b]);
    expect(merged).toHaveLength(2);
  });

  it('leaves a real branch point alone — three fragments meeting is not a through-point', () => {
    // A trunk plus two onward branches all touching (1,0): no single offset
    // direction is right past a fork, so nothing here should be fused.
    const trunk = line({ serviceId: 's', offset: 5 }, [
      [0, 0],
      [1, 0],
    ]);
    const branchA = line({ serviceId: 's', offset: 5 }, [
      [1, 0],
      [2, 1],
    ]);
    const branchB = line({ serviceId: 's', offset: 5 }, [
      [1, 0],
      [2, -1],
    ]);
    const merged = mergeAdjacentServiceLines([trunk, branchA, branchB]);
    expect(merged).toHaveLength(3);
  });

  it('does not join across a grade change (surface into a tunnel)', () => {
    const a = line({ serviceId: 's', offset: 0, underground: false }, [
      [0, 0],
      [1, 0],
    ]);
    const b = line({ serviceId: 's', offset: 0, underground: true }, [
      [1, 0],
      [1, 1],
    ]);
    const merged = mergeAdjacentServiceLines([a, b]);
    expect(merged).toHaveLength(2);
  });

  it('leaves a lone fragment untouched', () => {
    const a = line({ serviceId: 's', offset: 0 }, [
      [0, 0],
      [1, 0],
    ]);
    expect(mergeAdjacentServiceLines([a])).toEqual([a]);
  });
});
