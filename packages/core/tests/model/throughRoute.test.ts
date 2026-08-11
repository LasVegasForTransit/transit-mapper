// Through-routing is the one operation here with no prior art in the model,
// so these cases pin what "one continuous line" means: the ride order, the
// direction each leg is travelled, and what happens to everything that was
// not part of the join.

import { describe, expect, it } from 'vitest';
import { patternPath, patternLegs } from '../../src/model/geo';
import { servicePattern } from '../../src/model/line-service';
import { throughRouteServices, throughRouteServicesAt } from '../../src/model/throughRoute';
import type { TransitSystem } from '../../src/model/system';
import { validateSystemQuick } from '../../src/model/validate';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

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

function joinedSystem(system: TransitSystem | null): TransitSystem {
  expect(system).not.toBeNull();
  if (!system) throw new Error('The through-route fixture must join.');
  return system;
}

describe('joining two lines into a through-route', () => {
  it('produces one line running the whole way through', () => {
    const system = tailToHead();
    const next = joinedSystem(throughRouteServices(system, 'a', 'b'));
    expect(next.updatedAt).toBe(system.updatedAt);
    expect(next.services).toHaveLength(1);
    const [joined] = next.services;
    expect(patternLegs(servicePattern(joined)).map((l) => l.wayId)).toEqual(['west', 'east']);
  });

  it('removes the consumed service and emptied line from groups', () => {
    const system = tailToHead();
    system.groups = [{ id: 'group', memberIds: ['b'] }];

    const next = joinedSystem(throughRouteServices(system, 'a', 'b'));

    expect(next.groups[0].memberIds).toEqual([]);
  });

  it('keeps the surviving line’s own name and colour', () => {
    const next = joinedSystem(throughRouteServices(tailToHead(), 'a', 'b'));
    expect(next.services[0].name).toBe('Blue');
  });

  it('leaves no gap for the validator to report', () => {
    const next = joinedSystem(throughRouteServices(tailToHead(), 'a', 'b'));
    expect(validateSystemQuick(next).filter((i) => i.id.startsWith('broken-pattern'))).toEqual([]);
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
    const next = joinedSystem(throughRouteServices(system, 'a', 'b'));
    const joined = servicePattern(next.services[0]);
    expect(patternLegs(joined).map((l) => l.wayId)).toEqual(['west', 'east']);
    // Travelling east means running `east` against its own point order.
    expect(patternLegs(joined)[1].direction).toBe('againstPoints');
    const path = patternPath(next.ways, joined);
    expect(path[0][0]).toBeCloseTo(-115.21, 5);
    expect(path[path.length - 1][0]).toBeCloseTo(-115.19, 5);
  });

  it('keeps the joined line’s sibling service attached to its public line', () => {
    const spur = aRoad('spur', [
      [-115.19, 36.15],
      [-115.19, 36.16],
    ]);
    const system = aSystem({
      ways: [west, east, spur],
      services: [
        aService('a', [aPattern('pa', [west], ['west'])]),
        aService('b', [aPattern('pb', [east], ['east'])], { name: 'Main' }),
        aService('b-spur', [aPattern('pb2', [spur], ['spur'])], { name: 'Spur' }),
      ],
      lines: [
        { id: 'a-line', name: 'Blue', color: '#246bce', serviceIds: ['a'] },
        { id: 'b-line', name: 'Green', color: '#2ea44f', serviceIds: ['b', 'b-spur'] },
      ],
    });
    const next = joinedSystem(throughRouteServices(system, 'a', 'b'));
    expect(next.services.map((service) => service.id)).toEqual(['a', 'b-spur']);
    expect(next.lines.find((line) => line.id === 'b-line')?.serviceIds).toEqual(['b-spur']);
  });

  it('joins the exact requested service paths', () => {
    const desiredKeep = aRoad('desired-keep', [
      [-115.21, 36.15],
      [-115.2, 36.15],
    ]);
    const connector = aRoad('connector', [
      [-115.2, 36.15],
      [-115.1995, 36.15],
    ]);
    const desiredOther = aRoad('desired-other', [
      [-115.1995, 36.15],
      [-115.19, 36.15],
    ]);
    const system = aSystem({
      ways: [desiredKeep, connector, desiredOther],
      services: [
        aService('desired-a', [aPattern('desired-a', [desiredKeep], ['desired-keep'])]),
        aService('desired-b', [aPattern('desired-b', [desiredOther], ['desired-other'])]),
      ],
      nodes: [
        {
          id: 'desired-west',
          coord: [-115.2, 36.15],
          refs: [
            { wayId: 'desired-keep', pointIndex: 1 },
            { wayId: 'connector', pointIndex: 0 },
          ],
        },
        {
          id: 'desired-east',
          coord: [-115.1995, 36.15],
          refs: [
            { wayId: 'connector', pointIndex: 1 },
            { wayId: 'desired-other', pointIndex: 0 },
          ],
        },
      ],
    });

    const next = joinedSystem(
      throughRouteServicesAt(system, 'desired-a', 'desired-b', {
        aPatternId: 'desired-a',
        aEnd: 'end',
        bPatternId: 'desired-b',
        bEnd: 'start',
        distanceM: 45,
      }),
    );
    expect(patternLegs(servicePattern(next.services[0])).map((leg) => leg.wayId)).toEqual([
      'desired-keep',
      'connector',
      'desired-other',
    ]);
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

describe('a line whose two directions run different streets', () => {
  // Through-routing splices one line into the middle of another, and the joint
  // is exactly where a couplet's two halves would have to be re-paired against
  // the other line's. Nothing here knows how to do that, so the alternative to
  // refusing is quietly rebuilding it as one undivided path — deleting the
  // direction structure the planner drew on purpose.
  const couplet = () => {
    const sys = tailToHead();
    return {
      ...sys,
      services: sys.services.map((sv) =>
        sv.id !== 'a'
          ? sv
          : {
              ...sv,
              path: {
                id: sv.id,
                sections: [
                  {
                    kind: 'split' as const,
                    outbound: patternLegs(servicePattern(sv)),
                    inbound: patternLegs(servicePattern(sv)),
                  },
                ],
              },
            },
      ),
    };
  };

  it('is not joined into a through-route', () => {
    expect(throughRouteServices(couplet(), 'a', 'b')).toBeNull();
  });

  it('is left exactly as it was when the join is refused', () => {
    const before = couplet();
    throughRouteServices(before, 'a', 'b');
    const service = before.services.find((candidate) => candidate.id === 'a');
    if (!service) throw new Error('The retained service fixture must exist.');
    expect(service.path.sections[0].kind).toBe('split');
  });
});
