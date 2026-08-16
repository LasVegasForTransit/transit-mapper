import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildOverpassQuery,
  osmElementsToNetwork,
  type OsmWayElement,
} from '@transitmapper/core/model/import';
import { getComponent, laneRefKey } from '@transitmapper/core/model/components';
import { createEditorStore } from '../../src/editor/store';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { NamedWay } from '@transitmapper/core/model/system';

/** Throw-guard for a lookup this test's own setup guarantees succeeds — turns
 *  a silent `undefined`/`null` into a clear failure at the point of use
 *  instead of a confusing crash further down the assertion. */
function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

// Two primary-road ways meeting at a shared node, id 500. This is the base
// crossroads fixture reused (and extended) across several import specs below.
const twoWayCrossroad = (): OsmWayElement[] => [
  {
    type: 'way',
    id: 1,
    tags: { highway: 'primary' },
    nodes: [10, 500],
    geometry: [
      { lat: 36.1, lon: -115.2 },
      { lat: 36.1, lon: -115.15 },
    ],
  },
  {
    type: 'way',
    id: 2,
    tags: { highway: 'primary' },
    nodes: [500, 11],
    geometry: [
      { lat: 36.1, lon: -115.15 },
      { lat: 36.1, lon: -115.1 },
    ],
  },
];

describe('OSM import reads turn-restriction relations', () => {
  // A crossroads: `from` runs west->east into the junction, three arms leave.
  const junction = (restriction: string): OsmWayElement[] => [
    ...twoWayCrossroad(),
    {
      type: 'way',
      id: 3,
      tags: { highway: 'primary' },
      nodes: [500, 12],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.11, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 4,
      tags: { highway: 'primary' },
      nodes: [500, 13],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.09, lon: -115.15 },
      ],
    },
    {
      type: 'relation',
      id: 99,
      tags: { type: 'restriction', restriction },
      members: [
        { type: 'way', ref: 1, role: 'from' },
        { type: 'node', ref: 500, role: 'via' },
        { type: 'way', ref: 3, role: 'to' },
      ],
    },
  ];

  const banned = osmElementsToNetwork(junction('no_left_turn'));
  const fromWay = mustFind(
    banned.ways.find((w) => w.source === 'osm:1'),
    'way osm:1 in banned network',
  );
  const toWay = mustFind(
    banned.ways.find((w) => w.source === 'osm:3'),
    'way osm:3 in banned network',
  );
  const straightOn = mustFind(
    banned.ways.find((w) => w.source === 'osm:2'),
    'way osm:2 in banned network',
  );

  it('a no_* restriction produces a turn restriction', () => {
    expect(banned.turnRestrictions.length).toBeGreaterThan(0);
  });

  it("keyed against the approaching way's lanes", () => {
    expect(banned.turnRestrictions.every((t) => t.key.startsWith(`${fromWay.id}:`))).toBe(true);
  });

  it('the banned way is not an allowed target', () => {
    expect(
      banned.turnRestrictions.every((t) => !t.restriction.allowedTargets.includes(toWay.id)),
    ).toBe(true);
  });

  it('the other arms still are', () => {
    expect(
      banned.turnRestrictions.every((t) => t.restriction.allowedTargets.includes(straightOn.id)),
    ).toBe(true);
  });

  it('an only_* restriction permits just the named arm', () => {
    const only = osmElementsToNetwork(junction('only_straight_on'));
    expect(only.turnRestrictions.every((t) => t.restriction.allowedTargets.length === 1)).toBe(
      true,
    );
  });

  it('and that arm is the one named', () => {
    const only = osmElementsToNetwork(junction('only_straight_on'));
    const onlyToWay = mustFind(
      only.ways.find((w) => w.source === 'osm:3'),
      'way osm:3 in only-restriction network',
    );
    expect(
      only.turnRestrictions.every(
        (t) =>
          t.restriction.allowedTargets[0] === toWay.id ||
          t.restriction.allowedTargets[0] === onlyToWay.id,
      ),
    ).toBe(true);
  });

  // Vocabulary is checked: a typo must not be applied as a real ban.
  it('an unrecognised restriction value is ignored', () => {
    expect(osmElementsToNetwork(junction('no_lu_turn')).turnRestrictions).toHaveLength(0);
  });

  // A via-WAY restriction has no per-lane expression at one junction.
  it('a via-way restriction is skipped', () => {
    const viaWay: OsmWayElement[] = [
      ...junction('no_left_turn').slice(0, 4),
      {
        type: 'relation',
        id: 98,
        tags: { type: 'restriction', restriction: 'no_left_turn' },
        members: [
          { type: 'way', ref: 1, role: 'from' },
          { type: 'way', ref: 2, role: 'via' },
          { type: 'way', ref: 3, role: 'to' },
        ],
      },
    ];
    expect(osmElementsToNetwork(viaWay).turnRestrictions).toHaveLength(0);
  });

  // A relation naming a way the import skipped can't be applied safely.
  it('a restriction naming an unimported way is skipped', () => {
    const missingArm: OsmWayElement[] = [
      ...junction('no_left_turn').slice(0, 4),
      {
        type: 'relation',
        id: 97,
        tags: { type: 'restriction', restriction: 'no_left_turn' },
        members: [
          { type: 'way', ref: 1, role: 'from' },
          { type: 'node', ref: 500, role: 'via' },
          { type: 'way', ref: 42, role: 'to' },
        ],
      },
    ];
    expect(osmElementsToNetwork(missingArm).turnRestrictions).toHaveLength(0);
  });

  // The ban must land on lanes that could make the turn, not on a kerbside
  // bike lane that happens to be outermost.
  const bikeApproach = () => {
    const withBike = junction('no_right_turn').map((el) =>
      el.type === 'way' && el.id === 1
        ? { ...el, tags: { ...el.tags, 'cycleway:right': 'lane' } }
        : el,
    );
    const bikeNet = osmElementsToNetwork(withBike);
    const bikeFrom = mustFind(
      bikeNet.ways.find((w) => w.source === 'osm:1'),
      'way osm:1 in bike-approach network',
    );
    const bikeLaneIds = new Set(
      bikeFrom.profile.lanes.filter((l) => l.kindId === 'bike').map((l) => l.id),
    );
    return { bikeNet, bikeLaneIds };
  };

  it('the approach has a bike lane', () => {
    const { bikeLaneIds } = bikeApproach();
    expect(bikeLaneIds.size).toBe(1);
  });

  it('but no ban is placed on the bike lane', () => {
    const { bikeNet, bikeLaneIds } = bikeApproach();
    expect(bikeNet.turnRestrictions.every((t) => !bikeLaneIds.has(t.key.split(':')[1]))).toBe(true);
  });

  it('the query asks for restriction relations when importing streets', () => {
    expect(
      buildOverpassQuery({ west: -115.3, south: 36, east: -115, north: 36.2 }, ['road']),
    ).toContain('"type"="restriction"');
  });

  // End to end through the store.
  it('the store records the imported turn restrictions', () => {
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.imports.importWays(osmElementsToNetwork(junction('no_left_turn')));
    expect(Object.keys(store.getState().system.turnRestrictions).length).toBeGreaterThan(0);
  });

  it('each stored key names a lane that exists', () => {
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.imports.importWays(osmElementsToNetwork(junction('no_left_turn')));
    const storedFrom = mustFind(
      store.getState().system.ways.find((w) => w.source === 'osm:1'),
      'stored way osm:1',
    );
    expect(
      Object.keys(store.getState().system.turnRestrictions).every((k) =>
        storedFrom.profile.lanes.some((l) => laneRefKey(storedFrom.id, l.id) === k),
      ),
    ).toBe(true);
  });

  // And deleting the approach takes them with it, via touch()'s pruning.
  it('deleting the approach drops its imported restrictions', () => {
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.imports.importWays(osmElementsToNetwork(junction('no_left_turn')));
    const storedFrom = mustFind(
      store.getState().system.ways.find((w) => w.source === 'osm:1'),
      'stored way osm:1',
    );
    store.commands.ways.deleteWay(storedFrom.id);
    expect(Object.keys(store.getState().system.turnRestrictions)).toHaveLength(0);
  });
});

describe('OSM import pairs the carriageways of a divided street', () => {
  // Two one-way ways, same name, running opposite ways about 22 m apart.
  const divided: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', name: 'Grand Boulevard', oneway: 'yes', lanes: '2' },
      nodes: [10, 11],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary', name: 'Grand Boulevard', oneway: 'yes', lanes: '2' },
      nodes: [20, 21],
      geometry: [
        { lat: 36.1002, lon: -115.1 },
        { lat: 36.1002, lon: -115.2 },
      ],
    },
  ];
  const net = osmElementsToNetwork(divided);

  it('a divided street pairs into one identity', () => {
    expect(net.namedWays).toHaveLength(1);
  });

  it('the pair has exactly the two carriageways', () => {
    expect(net.namedWays[0].wayIds).toHaveLength(2);
  });

  it('which is the shape the combine tool needs', () => {
    expect(net.namedWays[0].name).toBe('Grand Boulevard');
  });

  it('and the median between them is captured', () => {
    expect(net.medians).toHaveLength(1);
    expect(net.medians[0].id).toBe(net.namedWays[0].id);
  });

  it('the captured median has a positive width', () => {
    expect(net.medians[0].median.widthM).toBeGreaterThan(0);
  });

  // Same street, same direction: not a carriageway pair.
  it('two same-direction one-ways are not a carriageway pair', () => {
    const sameWay: OsmWayElement[] = [
      divided[0],
      {
        type: 'way',
        id: 2,
        tags: { highway: 'primary', name: 'Grand Boulevard', oneway: 'yes', lanes: '2' },
        nodes: [20, 21],
        geometry: [
          { lat: 36.1002, lon: -115.2 },
          { lat: 36.1002, lon: -115.1 },
        ],
      },
    ];
    expect(osmElementsToNetwork(sameWay).medians).toHaveLength(0);
  });

  it('they keep the ordinary whole-street identity', () => {
    const sameWay: OsmWayElement[] = [
      divided[0],
      {
        type: 'way',
        id: 2,
        tags: { highway: 'primary', name: 'Grand Boulevard', oneway: 'yes', lanes: '2' },
        nodes: [20, 21],
        geometry: [
          { lat: 36.1002, lon: -115.2 },
          { lat: 36.1002, lon: -115.1 },
        ],
      },
    ];
    const parallelSame = osmElementsToNetwork(sameWay);
    expect(parallelSame.namedWays).toHaveLength(1);
    expect(parallelSame.namedWays[0].wayIds).toHaveLength(2);
  });

  // Too far apart to be one street's carriageways.
  it('opposite one-ways a block apart are not paired', () => {
    const farApart: OsmWayElement[] = [
      divided[0],
      {
        type: 'way',
        id: 2,
        tags: { highway: 'primary', name: 'Grand Boulevard', oneway: 'yes', lanes: '2' },
        nodes: [20, 21],
        geometry: [
          { lat: 36.11, lon: -115.1 },
          { lat: 36.11, lon: -115.2 },
        ],
      },
    ];
    expect(osmElementsToNetwork(farApart).medians).toHaveLength(0);
  });

  // Two-way streets are never carriageways.
  it('two-way ways are never paired as carriageways', () => {
    const twoWay: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'primary', name: 'Plain Street', lanes: '2' },
        nodes: [10, 11],
        geometry: [
          { lat: 36.2, lon: -115.2 },
          { lat: 36.2, lon: -115.1 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { highway: 'primary', name: 'Plain Street', lanes: '2' },
        nodes: [20, 21],
        geometry: [
          { lat: 36.2002, lon: -115.1 },
          { lat: 36.2002, lon: -115.2 },
        ],
      },
    ];
    expect(osmElementsToNetwork(twoWay).medians).toHaveLength(0);
  });

  // A frontage road alongside the pair must not steal a carriageway: pairing
  // is mutual-best-match, so the two true carriageways choose each other.
  it('a frontage road does not break the true pair', () => {
    const withFrontage: OsmWayElement[] = [
      ...divided,
      {
        type: 'way',
        id: 3,
        tags: { highway: 'service', name: 'Grand Boulevard', oneway: 'yes', lanes: '1' },
        nodes: [30, 31],
        geometry: [
          { lat: 36.1004, lon: -115.2 },
          { lat: 36.1004, lon: -115.1 },
        ],
      },
    ];
    const fronted = osmElementsToNetwork(withFrontage);
    expect(fronted.namedWays.some((n) => n.wayIds.length === 2)).toBe(true);
  });

  // End to end: the store gets a two-member identity with its median, which
  // is exactly what the Combine affordance requires.
  describe('through the store', () => {
    let store: ReturnType<typeof createEditorStore>;
    let nw: NamedWay;

    beforeEach(() => {
      store = createEditorStore();
      store.commands.document.setSystem(createEmptySystem());
      store.commands.imports.importWays(osmElementsToNetwork(divided));
      nw = store.getState().system.namedWays[0];
    });

    it('the store receives a two-carriageway identity', () => {
      expect(nw.wayIds).toHaveLength(2);
    });

    it('with its median stored against it', () => {
      expect(getComponent(store.getState().system.medians, nw.id)).toBeDefined();
    });

    it('so the divided street combines into one two-way street', () => {
      store.commands.network.combineCarriageways(nw.id);
      expect(store.getState().system.ways).toHaveLength(1);
    });

    it('carrying a median lane from the captured gap', () => {
      store.commands.network.combineCarriageways(nw.id);
      expect(store.getState().system.ways[0].profile.lanes.some((l) => l.kindId === 'median')).toBe(
        true,
      );
    });
  });
});
