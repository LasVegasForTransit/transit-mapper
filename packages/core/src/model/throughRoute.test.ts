// Through-routing is the one operation here with no prior art in the model,
// so these cases pin what "one continuous line" means: the ride order, the
// direction each leg is travelled, and what happens to everything that was
// not part of the join.

import { describe, expect, it } from 'vitest';
import { patternPath } from './geo';
import { throughRouteServices } from './throughRoute';
import { validateSystemQuick } from './validate';
import { aPattern, aRoad, aService, aSystem } from '../testing/fixtures';

const west = aRoad('west', [
  [-115.21, 36.15],
  [-115.2, 36.15],
]);
const east = aRoad('east', [
  [-115.2, 36.15],
  [-115.19, 36.15],
]);

/** Two lines meeting nose to tail at [-115.20, 36.15]. */
function tailToHead() {
  return aSystem({
    ways: [west, east],
    services: [
      aService('a', [aPattern('pa', [west], ['west'])], { name: 'Blue' }),
      aService('b', [aPattern('pb', [east], ['east'])], { name: 'Green' }),
    ],
  });
}

describe('joining two lines into a through-route', () => {
  it('produces one line running the whole way through', () => {
    const next = throughRouteServices(tailToHead(), 'a', 'b');
    expect(next).not.toBeNull();
    expect(next!.services).toHaveLength(1);
    const [joined] = next!.services;
    expect(joined.patterns).toHaveLength(1);
    expect(joined.patterns[0].legs.map((l) => l.wayId)).toEqual(['west', 'east']);
  });

  it('keeps the surviving line’s own name and colour', () => {
    const next = throughRouteServices(tailToHead(), 'a', 'b');
    expect(next!.services[0].name).toBe('Blue');
  });

  it('leaves no gap for the validator to report', () => {
    const next = throughRouteServices(tailToHead(), 'a', 'b');
    expect(validateSystemQuick(next!).filter((i) => i.id.startsWith('broken-pattern'))).toEqual([]);
  });

  it('reverses one line when the two lines meet head to head', () => {
    // `east` drawn the other way round, so both lines start at the shared point.
    const eastReversed = aRoad('east', [
      [-115.19, 36.15],
      [-115.2, 36.15],
    ]);
    const system = aSystem({
      ways: [west, eastReversed],
      services: [
        aService('a', [aPattern('pa', [west], ['west'])]),
        aService('b', [aPattern('pb', [eastReversed], ['east'])]),
      ],
    });
    const next = throughRouteServices(system, 'a', 'b');
    const joined = next!.services[0].patterns[0];
    expect(joined.legs.map((l) => l.wayId)).toEqual(['west', 'east']);
    // Travelling east means running `east` against its own point order.
    expect(joined.legs[1].direction).toBe('againstPoints');
    const path = patternPath(next!.ways, joined);
    expect(path[0][0]).toBeCloseTo(-115.21, 5);
    expect(path[path.length - 1][0]).toBeCloseTo(-115.19, 5);
  });

  it('carries the joined line’s other branches over as branches', () => {
    const spur = aRoad('spur', [
      [-115.19, 36.15],
      [-115.19, 36.16],
    ]);
    const system = aSystem({
      ways: [west, east, spur],
      services: [
        aService('a', [aPattern('pa', [west], ['west'])]),
        aService('b', [aPattern('pb', [east], ['east']), aPattern('pb2', [spur], ['spur'])], {
          name: 'Green',
        }),
      ],
    });
    const next = throughRouteServices(system, 'a', 'b');
    const [joined] = next!.services;
    expect(joined.patterns).toHaveLength(2);
    expect(joined.patterns[1].name).toBe('Green');
  });

  it('refuses two lines of different modes', () => {
    const system = aSystem({
      ...tailToHead(),
      services: tailToHead().services.map((s) => (s.id === 'b' ? { ...s, modeId: 'subway' } : s)),
    });
    expect(throughRouteServices(system, 'a', 'b')).toBeNull();
  });

  it('refuses two lines whose ends are nowhere near each other', () => {
    const far = aRoad('far', [
      [-115.15, 36.18],
      [-115.14, 36.18],
    ]);
    const system = aSystem({
      ways: [west, far],
      services: [
        aService('a', [aPattern('pa', [west], ['west'])]),
        aService('b', [aPattern('pb', [far], ['far'])]),
      ],
    });
    expect(throughRouteServices(system, 'a', 'b')).toBeNull();
  });

  it('refuses two lines whose ends are close but unconnected by any street', () => {
    // 40 m short of `west`'s end, with nothing bridging the two.
    const detached = aRoad('detached', [
      [-115.1995, 36.15],
      [-115.19, 36.15],
    ]);
    const system = aSystem({
      ways: [west, detached],
      services: [
        aService('a', [aPattern('pa', [west], ['west'])]),
        aService('b', [aPattern('pb', [detached], ['detached'])]),
      ],
    });
    expect(throughRouteServices(system, 'a', 'b')).toBeNull();
  });
});
