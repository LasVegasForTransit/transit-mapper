// A document can say things the model does not allow — it was saved before a
// rule existed, or edited by hand, or migrated by a guess. Loading it repairs
// those rather than reporting them, because a person reading such a warning
// could do nothing except accept it. Each case here is one contradiction and
// what the loader leaves behind.

import { describe, expect, it } from 'vitest';
import { withSingleTypeArms, wayTypeIndex } from '../../src/model/junctions';
import { parseSystem } from '../../src/model/serialize';
import { findMismatchedTypeJunctions, validateSystem } from '../../src/model/validate';
import type { Node } from '../../src/model/system';
import { patternLegs } from '../../src/model/geo';
import { servicePattern } from '../../src/model/line-service';
import { aPattern, aRoad, aService, aStop, aSystem } from '../support/fixtures.test';

/** A road running east-west and a rail line running north-south, both with a
 *  control point at the same coordinate. */
function crossingPair() {
  return [
    aRoad('road-west', [
      [-115.2, 36.1],
      [-115.15, 36.1],
    ]),
    aRoad('road-east', [
      [-115.15, 36.1],
      [-115.1, 36.1],
    ]),
    aRoad(
      'rail',
      [
        [-115.15, 36.05],
        [-115.15, 36.1],
      ],
      { typeId: 'lightRail' },
    ),
  ];
}

const mixedJunction: Node = {
  id: 'n',
  coord: [-115.15, 36.1],
  refs: [
    { wayId: 'road-west', pointIndex: 1 },
    { wayId: 'road-east', pointIndex: 0 },
    { wayId: 'rail', pointIndex: 1 },
  ],
};

describe('a junction joining more than one way type', () => {
  it('keeps the arms of the type most of them are', () => {
    const [node] = withSingleTypeArms([mixedJunction], wayTypeIndex(crossingPair()));
    expect(node.refs.map((r) => r.wayId)).toEqual(['road-west', 'road-east']);
  });

  it('stops being a junction when one type cannot muster two arms', () => {
    const twoArms: Node = { ...mixedJunction, refs: mixedJunction.refs.slice(1) };
    expect(withSingleTypeArms([twoArms], wayTypeIndex(crossingPair()))).toEqual([]);
  });

  it('loses the turn lanes that fed the arm it dropped', () => {
    const withConnectors: Node = {
      ...mixedJunction,
      connectors: [
        { from: { wayId: 'road-west', laneId: 'a' }, to: { wayId: 'road-east', laneId: 'b' } },
        { from: { wayId: 'rail', laneId: 'c' }, to: { wayId: 'road-east', laneId: 'b' } },
      ],
    };
    const [node] = withSingleTypeArms([withConnectors], wayTypeIndex(crossingPair()));
    expect(node.connectors).toEqual([
      { from: { wayId: 'road-west', laneId: 'a' }, to: { wayId: 'road-east', laneId: 'b' } },
    ]);
  });

  it('leaves a junction of one type exactly as it was', () => {
    const ways = crossingPair();
    const sameType: Node = { ...mixedJunction, refs: mixedJunction.refs.slice(0, 2) };
    const [node] = withSingleTypeArms([sameType], wayTypeIndex(ways));
    expect(node).toBe(sameType);
  });

  it('is repaired by loading the document, not reported to the person', () => {
    const saved = aSystem({ ways: crossingPair(), nodes: [mixedJunction] });
    const loaded = parseSystem(JSON.parse(JSON.stringify(saved)));
    expect(findMismatchedTypeJunctions(loaded)).toEqual([]);
    expect(loaded.nodes[0].refs.map((r) => r.wayId)).toEqual(['road-west', 'road-east']);
    // Nothing moves: the rail line still runs through the same coordinate,
    // which is what a level crossing looks like until the model has one.
    // (Within the float drift of parse's own longitude wrap, not exactly.)
    const rail = loaded.ways.find((way) => way.id === 'rail');
    if (!rail) throw new Error('Expected the repaired rail way');
    const railEnd = rail.points[1];
    expect(railEnd[0]).toBeCloseTo(-115.15, 9);
    expect(railEnd[1]).toBeCloseTo(36.1, 9);
  });
});

describe('a document referring to a way that cannot be drawn', () => {
  const ghost = aRoad('ghost', [[-115.2, 36.1]]);

  function savedWithGhost() {
    return aSystem({
      ways: [...crossingPair(), ghost],
      stops: [aStop('st', [-115.2, 36.1], { wayId: 'ghost', t: 0.5 })],
      nodes: [
        {
          id: 'g',
          coord: [-115.2, 36.1],
          refs: [
            { wayId: 'ghost', pointIndex: 0 },
            { wayId: 'road-west', pointIndex: 0 },
          ],
        },
      ],
      namedWays: [{ id: 'name', name: 'Ghost Street', wayIds: ['ghost'] }],
    });
  }

  it('drops the way, since a single point draws nothing', () => {
    const loaded = parseSystem(JSON.parse(JSON.stringify(savedWithGhost())));
    expect(loaded.ways.map((w) => w.id)).not.toContain('ghost');
  });

  it('drops everything that pointed at it, leaving nothing dangling', () => {
    const loaded = parseSystem(JSON.parse(JSON.stringify(savedWithGhost())));
    expect(loaded.stops[0].anchors).toEqual([]);
    expect(loaded.nodes).toEqual([]);
    expect(loaded.namedWays).toEqual([]);
  });

  it('keeps the stop itself — where it sits was never in question', () => {
    const loaded = parseSystem(JSON.parse(JSON.stringify(savedWithGhost())));
    expect(loaded.stops.map((s) => s.id)).toEqual(['st']);
  });

  it('leaves the loaded system with nothing to report', () => {
    const loaded = parseSystem(JSON.parse(JSON.stringify(savedWithGhost())));
    expect(validateSystem(loaded)).toEqual([]);
  });
});

describe('a line riding a way that cannot be drawn', () => {
  function savedWithLine() {
    const ways = [...crossingPair(), aRoad('ghost', [[-115.2, 36.1]])];
    return aSystem({
      ways,
      services: [aService('line', [aPattern('p', ways, ['road-west', 'ghost'])])],
    });
  }

  it('keeps the line, and only drops the leg that named the way', () => {
    const loaded = parseSystem(JSON.parse(JSON.stringify(savedWithLine())));
    expect(loaded.services.map((sv) => sv.id)).toEqual(['line']);
    expect(patternLegs(servicePattern(loaded.services[0])).map((l) => l.wayId)).toEqual([
      'road-west',
    ]);
  });

  it('leaves a line that ends up riding nothing for the person to deal with', () => {
    const ways = [aRoad('ghost', [[-115.2, 36.1]])];
    const saved = aSystem({
      ways,
      services: [aService('line', [aPattern('p', ways, ['ghost'])])],
    });
    const loaded = parseSystem(JSON.parse(JSON.stringify(saved)));
    expect(loaded.services.map((sv) => sv.id)).toEqual(['line']);
    // Reported, not repaired: deleting somebody's line is their call.
    expect(validateSystem(loaded).map((i) => i.id)).toEqual(['ghost-service-line']);
  });
});

describe('a stop anchored to a way that is not in the document', () => {
  it('keeps the stop and drops the anchor', () => {
    const saved = aSystem({
      ways: crossingPair(),
      stops: [aStop('st', [-115.18, 36.1], { wayId: 'deleted-long-ago', t: 0.5 })],
    });
    const loaded = parseSystem(JSON.parse(JSON.stringify(saved)));
    expect(loaded.stops[0].anchors).toEqual([]);
    expect(validateSystem(loaded)).toEqual([]);
  });
});

// The repair runs on every load, so the case that matters most is the one
// where there is nothing to repair.
describe('a document that says nothing the model disallows', () => {
  it('comes back from a load unchanged', () => {
    const ways = crossingPair();
    const saved = aSystem({
      ways,
      nodes: [{ ...mixedJunction, refs: mixedJunction.refs.slice(0, 2) }],
      stops: [aStop('st', [-115.18, 36.1], { wayId: 'road-west', t: 0.5 })],
      services: [aService('line', [aPattern('p', ways, ['road-west', 'road-east'])])],
      namedWays: [{ id: 'name', name: 'Russell Road', wayIds: ['road-west', 'road-east'] }],
    });
    const loaded = parseSystem(JSON.parse(JSON.stringify(saved)));
    // Record for record, not field for field: parse normalizes coordinates
    // and fills optional keys, which is its own business and predates this.
    // What the repair must never do is DROP any of it.
    expect(loaded.ways.map((w) => w.id)).toEqual(saved.ways.map((w) => w.id));
    expect(loaded.nodes.map((n) => n.refs)).toEqual(saved.nodes.map((n) => n.refs));
    expect(loaded.stops.map((st) => st.anchors)).toEqual(saved.stops.map((st) => st.anchors));
    expect(loaded.services[0].path.sections).toEqual(saved.services[0].path.sections);
    expect(loaded.namedWays).toEqual(saved.namedWays);
  });
});
