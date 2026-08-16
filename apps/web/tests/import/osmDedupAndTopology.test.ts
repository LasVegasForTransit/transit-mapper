import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildOverpassQuery,
  osmElementsToNetwork,
  withoutAlreadyImported,
  type OsmWayElement,
} from '@transitmapper/core/model/import';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { getComponent, laneRefKey } from '@transitmapper/core/model/components';
import { validateSystem } from '@transitmapper/core/model/validate';
import { createEditorStore } from '../../src/editor/store';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { NamedWay, Node, Way } from '@transitmapper/core/model/system';

describe("re-importing an area doesn't duplicate what's already there", () => {
  const area: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      nodes: [10, 500],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'residential' },
      nodes: [500, 11],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
  ];

  describe('a first import into an empty system', () => {
    const first = withoutAlreadyImported(osmElementsToNetwork(area), []);

    it('keeps every way', () => {
      expect(first.network.ways).toHaveLength(2);
    });

    it('skips nothing', () => {
      expect(first.duplicateWays).toBe(0);
    });

    it('keeps its junction', () => {
      expect(first.network.nodes).toHaveLength(1);
    });
  });

  describe('re-importing the exact same area', () => {
    const first = withoutAlreadyImported(osmElementsToNetwork(area), []);
    const again = withoutAlreadyImported(osmElementsToNetwork(area), first.network.ways);

    it('adds no ways', () => {
      expect(again.network.ways).toHaveLength(0);
    });

    it('reports what it skipped', () => {
      expect(again.duplicateWays).toBe(2);
    });

    it('adds no duplicate junction', () => {
      expect(again.network.nodes).toHaveLength(0);
    });
  });

  // A neighbouring area that overlaps: Overpass returns way 2 whole again.
  describe('a neighbouring area that overlaps', () => {
    const first = withoutAlreadyImported(osmElementsToNetwork(area), []);
    const neighbour: OsmWayElement[] = [
      area[1],
      {
        type: 'way',
        id: 3,
        tags: { highway: 'residential' },
        nodes: [11, 12],
        geometry: [
          { lat: 36.1, lon: -115.1 },
          { lat: 36.1, lon: -115.05 },
        ],
      },
    ];
    const seam = withoutAlreadyImported(osmElementsToNetwork(neighbour), first.network.ways);

    it("keeps only what's new", () => {
      expect(seam.network.ways).toHaveLength(1);
      expect(seam.duplicateWays).toBe(1);
    });

    it('the seam junction survives', () => {
      expect(seam.network.nodes).toHaveLength(1);
    });

    it('the seam junction points one ref at the already-present way', () => {
      const seamRefs = seam.network.nodes[0].refs;
      expect(seamRefs.some((r) => first.network.ways.some((w) => w.id === r.wayId))).toBe(true);
    });

    it('and one ref at the newly imported way', () => {
      const seamRefs = seam.network.nodes[0].refs;
      expect(seamRefs.some((r) => r.wayId === seam.network.ways[0].id)).toBe(true);
    });
  });

  // A way the user has since edited: still a duplicate, but its indices no
  // longer mean what OSM meant, so refs into it are not re-pointed.
  describe('a way the user has since edited', () => {
    const first = withoutAlreadyImported(osmElementsToNetwork(area), []);
    const neighbour: OsmWayElement[] = [
      area[1],
      {
        type: 'way',
        id: 3,
        tags: { highway: 'residential' },
        nodes: [11, 12],
        geometry: [
          { lat: 36.1, lon: -115.1 },
          { lat: 36.1, lon: -115.05 },
        ],
      },
    ];
    const edited = first.network.ways.map((w) =>
      w.source === 'osm:2'
        ? { ...w, points: [...w.points, [-115.05, 36.1] as [number, number]] }
        : w,
    );
    const afterEdit = withoutAlreadyImported(osmElementsToNetwork(neighbour), edited);

    it('is still recognised as a duplicate', () => {
      expect(afterEdit.duplicateWays).toBe(1);
    });

    it('but no junction is placed on its shifted indices', () => {
      expect(afterEdit.network.nodes).toHaveLength(0);
    });
  });

  // A junction the system already has must GAIN the new arm, not acquire a
  // rival Node at the same coordinate. Two Nodes there is not cosmetic:
  // cascadeMove finds only the first, so dragging the junction strands the
  // other's arms, and setNodeControl reaches only one of them.
  describe('a junction the system already has gains the new arm', () => {
    const first = withoutAlreadyImported(osmElementsToNetwork(area), []);
    const withBike: OsmWayElement[] = [
      ...area,
      {
        type: 'way',
        id: 4,
        tags: { highway: 'cycleway' },
        nodes: [500, 40],
        geometry: [
          { lat: 36.1, lon: -115.15 },
          { lat: 36.11, lon: -115.15 },
        ],
      },
    ];
    const widened = withoutAlreadyImported(
      osmElementsToNetwork(withBike),
      first.network.ways,
      first.network.namedWays,
      first.network.nodes,
    );

    it('adds no rival junction', () => {
      expect(widened.network.nodes).toHaveLength(0);
    });

    it('the existing junction gains the new arm instead', () => {
      expect(widened.junctionAdditions).toHaveLength(1);
      expect(widened.junctionAdditions[0].refs).toHaveLength(1);
    });

    it('the arm names the newly imported way', () => {
      expect(widened.junctionAdditions[0].refs[0].wayId).toBe(widened.network.ways[0].id);
    });
  });

  describe('the store keeps one junction across two sequential imports', () => {
    const withBike: OsmWayElement[] = [
      ...area,
      {
        type: 'way',
        id: 4,
        tags: { highway: 'cycleway' },
        nodes: [500, 40],
        geometry: [
          { lat: 36.1, lon: -115.15 },
          { lat: 36.11, lon: -115.15 },
        ],
      },
    ];
    let store: ReturnType<typeof createEditorStore>;
    let beforeNodes: number;
    let shared: Node[];

    beforeEach(() => {
      store = createEditorStore();
      store.getState().setSystem(createEmptySystem());
      store.getState().importWays(osmElementsToNetwork(area));
      beforeNodes = store.getState().system.nodes.length;
      store.getState().importWays(osmElementsToNetwork(withBike));
      shared = store
        .getState()
        .system.nodes.filter((n) => n.coord[0] === -115.15 && n.coord[1] === 36.1);
    });

    it('keeps one junction at the shared coordinate', () => {
      expect(beforeNodes).toBe(1);
      expect(shared).toHaveLength(1);
    });

    it('and it now has three arms', () => {
      expect(shared[0].refs).toHaveLength(3);
    });

    it('every arm names a way that exists', () => {
      expect(
        shared[0].refs.every((r) => store.getState().system.ways.some((w) => w.id === r.wayId)),
      ).toBe(true);
    });
  });

  // Street identities follow the same rule as junctions.
  describe('street identities follow the same rule as junctions', () => {
    const namedArea: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [10, 500],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.15 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [500, 11],
        geometry: [
          { lat: 36.1, lon: -115.15 },
          { lat: 36.1, lon: -115.1 },
        ],
      },
    ];
    const namedFirst = withoutAlreadyImported(osmElementsToNetwork(namedArea), []);

    it('a first import keeps its street identity', () => {
      expect(namedFirst.network.namedWays).toHaveLength(1);
    });

    it('re-importing adds no duplicate identity', () => {
      expect(
        withoutAlreadyImported(
          osmElementsToNetwork(namedArea),
          namedFirst.network.ways,
          namedFirst.network.namedWays,
        ).network.namedWays,
      ).toHaveLength(0);
    });
  });

  // A street continuing into a neighbouring import must end up in ONE
  // identity: a second one would rename half the street and would double-count
  // the shared way in the member count the carriageway tools gate on.
  describe('a street continuing into a neighbouring import', () => {
    const namedArea: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [10, 500],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.15 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [500, 11],
        geometry: [
          { lat: 36.1, lon: -115.15 },
          { lat: 36.1, lon: -115.1 },
        ],
      },
    ];
    const namedFirst = withoutAlreadyImported(osmElementsToNetwork(namedArea), []);
    const namedNeighbour: OsmWayElement[] = [
      namedArea[1],
      {
        type: 'way',
        id: 3,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [11, 12],
        geometry: [
          { lat: 36.1, lon: -115.1 },
          { lat: 36.1, lon: -115.05 },
        ],
      },
    ];
    const extended = withoutAlreadyImported(
      osmElementsToNetwork(namedNeighbour),
      namedFirst.network.ways,
      namedFirst.network.namedWays,
    );

    it('creates no second identity', () => {
      expect(extended.network.namedWays).toHaveLength(0);
    });

    it('extends the identity it already has', () => {
      expect(extended.identityAdditions).toHaveLength(1);
      expect(extended.identityAdditions[0].id).toBe(namedFirst.network.namedWays[0].id);
    });

    it('only the genuinely new way is added to it', () => {
      expect(extended.identityAdditions[0].wayIds).toHaveLength(1);
    });
  });

  // Same name, different way type, is still a different facility.
  describe('same name, different way type stays a different facility', () => {
    const namedArea: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [10, 500],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.15 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [500, 11],
        geometry: [
          { lat: 36.1, lon: -115.15 },
          { lat: 36.1, lon: -115.1 },
        ],
      },
    ];
    const namedFirst = withoutAlreadyImported(osmElementsToNetwork(namedArea), []);
    const tramNamed: OsmWayElement[] = [
      {
        type: 'way',
        id: 8,
        tags: { railway: 'tram', name: 'Main Street' },
        nodes: [80, 81],
        geometry: [
          { lat: 36.3, lon: -115.2 },
          { lat: 36.3, lon: -115.15 },
        ],
      },
      {
        type: 'way',
        id: 9,
        tags: { railway: 'tram', name: 'Main Street' },
        nodes: [81, 82],
        geometry: [
          { lat: 36.3, lon: -115.15 },
          { lat: 36.3, lon: -115.1 },
        ],
      },
    ];
    const tram = withoutAlreadyImported(
      osmElementsToNetwork(tramNamed),
      namedFirst.network.ways,
      namedFirst.network.namedWays,
    );

    it("does not join the road's identity", () => {
      expect(tram.network.namedWays).toHaveLength(1);
      expect(tram.identityAdditions).toHaveLength(0);
    });
  });

  // And the store applies the merge, so no way ends up in two identities.
  describe('the store applies named-way merges without double-membership', () => {
    const namedArea: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [10, 500],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.15 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [500, 11],
        geometry: [
          { lat: 36.1, lon: -115.15 },
          { lat: 36.1, lon: -115.1 },
        ],
      },
    ];
    const namedNeighbour: OsmWayElement[] = [
      namedArea[1],
      {
        type: 'way',
        id: 3,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [11, 12],
        geometry: [
          { lat: 36.1, lon: -115.1 },
          { lat: 36.1, lon: -115.05 },
        ],
      },
    ];
    let store: ReturnType<typeof createEditorStore>;

    beforeEach(() => {
      store = createEditorStore();
      store.getState().setSystem(createEmptySystem());
      store.getState().importWays(osmElementsToNetwork(namedArea));
      store.getState().importWays(osmElementsToNetwork(namedNeighbour));
    });

    it('leaves every way in at most one identity', () => {
      const memberships = new Map<string, number>();
      for (const n of store.getState().system.namedWays)
        for (const id of n.wayIds) memberships.set(id, (memberships.get(id) ?? 0) + 1);
      expect([...memberships.values()].every((n) => n === 1)).toBe(true);
    });

    it('the street is one identity spanning all three ways', () => {
      expect(store.getState().system.namedWays).toHaveLength(1);
      expect(store.getState().system.namedWays[0].wayIds).toHaveLength(3);
    });
  });

  // Hand-drawn ways have no source and must never be mistaken for imports.
  describe('hand-drawn ways are never mistaken for imports', () => {
    it('never count as duplicates', () => {
      const handDrawn: Way[] = [
        {
          id: 'drawn',
          typeId: 'road',
          points: [
            [-115.2, 36.1],
            [-115.15, 36.1],
          ],
          geometry: 'straight',
          grade: 'atGrade',
          profile: defaultProfileFor('road'),
        },
      ];
      expect(withoutAlreadyImported(osmElementsToNetwork(area), handDrawn).duplicateWays).toBe(0);
    });

    // And the store enforces it, whatever the caller passes.
    it('the store skips duplicates rather than trusting the caller', () => {
      const store = createEditorStore();
      store.getState().setSystem(createEmptySystem());
      store.getState().importWays(osmElementsToNetwork(area));
      store.getState().importWays(osmElementsToNetwork(area));
      expect(store.getState().system.ways).toHaveLength(2);
    });

    it('the store reports added/skipped', () => {
      const store = createEditorStore();
      store.getState().setSystem(createEmptySystem());
      store.getState().importWays(osmElementsToNetwork(area));
      const second = store.getState().importWays(osmElementsToNetwork(area));
      expect(second.added).toBe(0);
      expect(second.skipped).toBe(2);
    });
  });
});

describe('OSM import reads turn-restriction relations', () => {
  // A crossroads: `from` runs west->east into the junction, three arms leave.
  const junction = (restriction: string): OsmWayElement[] => [
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
  const fromWay = banned.ways.find((w) => w.source === 'osm:1')!;
  const toWay = banned.ways.find((w) => w.source === 'osm:3')!;
  const straightOn = banned.ways.find((w) => w.source === 'osm:2')!;

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
    expect(
      only.turnRestrictions.every(
        (t) =>
          t.restriction.allowedTargets[0] === toWay.id ||
          t.restriction.allowedTargets[0] === only.ways.find((w) => w.source === 'osm:3')!.id,
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
  it('the approach has a bike lane', () => {
    const withBike = junction('no_right_turn').map((el) =>
      el.type === 'way' && el.id === 1
        ? { ...el, tags: { ...el.tags, 'cycleway:right': 'lane' } }
        : el,
    );
    const bikeNet = osmElementsToNetwork(withBike);
    const bikeFrom = bikeNet.ways.find((w) => w.source === 'osm:1')!;
    const bikeLaneIds = new Set(
      bikeFrom.profile.lanes.filter((l) => l.kindId === 'bike').map((l) => l.id),
    );
    expect(bikeLaneIds.size).toBe(1);
  });

  it('but no ban is placed on the bike lane', () => {
    const withBike = junction('no_right_turn').map((el) =>
      el.type === 'way' && el.id === 1
        ? { ...el, tags: { ...el.tags, 'cycleway:right': 'lane' } }
        : el,
    );
    const bikeNet = osmElementsToNetwork(withBike);
    const bikeFrom = bikeNet.ways.find((w) => w.source === 'osm:1')!;
    const bikeLaneIds = new Set(
      bikeFrom.profile.lanes.filter((l) => l.kindId === 'bike').map((l) => l.id),
    );
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
    store.getState().setSystem(createEmptySystem());
    store.getState().importWays(osmElementsToNetwork(junction('no_left_turn')));
    expect(Object.keys(store.getState().system.turnRestrictions).length).toBeGreaterThan(0);
  });

  it('each stored key names a lane that exists', () => {
    const store = createEditorStore();
    store.getState().setSystem(createEmptySystem());
    store.getState().importWays(osmElementsToNetwork(junction('no_left_turn')));
    const storedFrom = store.getState().system.ways.find((w) => w.source === 'osm:1')!;
    expect(
      Object.keys(store.getState().system.turnRestrictions).every((k) =>
        storedFrom.profile.lanes.some((l) => laneRefKey(storedFrom.id, l.id) === k),
      ),
    ).toBe(true);
  });

  // And deleting the approach takes them with it, via touch()'s pruning.
  it('deleting the approach drops its imported restrictions', () => {
    const store = createEditorStore();
    store.getState().setSystem(createEmptySystem());
    store.getState().importWays(osmElementsToNetwork(junction('no_left_turn')));
    const storedFrom = store.getState().system.ways.find((w) => w.source === 'osm:1')!;
    store.getState().deleteWay(storedFrom.id);
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
      store.getState().setSystem(createEmptySystem());
      store.getState().importWays(osmElementsToNetwork(divided));
      nw = store.getState().system.namedWays[0];
    });

    it('the store receives a two-carriageway identity', () => {
      expect(nw.wayIds).toHaveLength(2);
    });

    it('with its median stored against it', () => {
      expect(getComponent(store.getState().system.medians, nw.id)).toBeDefined();
    });

    it('so the divided street combines into one two-way street', () => {
      store.getState().combineCarriageways(nw.id);
      expect(store.getState().system.ways).toHaveLength(1);
    });

    it('carrying a median lane from the captured gap', () => {
      store.getState().combineCarriageways(nw.id);
      expect(store.getState().system.ways[0].profile.lanes.some((l) => l.kindId === 'median')).toBe(
        true,
      );
    });
  });
});

describe('OSM import derives junctions from node identity, not coordinates', () => {
  // Two streets crossing at OSM node 500, which is each way's middle point.
  const crossing: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      nodes: [100, 500, 101],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'residential' },
      nodes: [200, 500, 201],
      geometry: [
        { lat: 36.05, lon: -115.15 },
        { lat: 36.1, lon: -115.15 },
        { lat: 36.15, lon: -115.15 },
      ],
    },
  ];
  const net = osmElementsToNetwork(crossing);

  it('osmElementsToNetwork returns both ways', () => {
    expect(net.ways).toHaveLength(2);
  });

  it('a node id shared by two ways becomes exactly one junction', () => {
    expect(net.nodes).toHaveLength(1);
  });

  it('the junction carries one ref per way', () => {
    expect(net.nodes[0].refs).toHaveLength(2);
  });

  it("each ref points at the shared node's own control point index", () => {
    expect(net.nodes[0].refs.map((r) => r.pointIndex)).toEqual([1, 1]);
  });

  it("the junction's refs name the imported ways", () => {
    expect(net.nodes[0].refs.every((r) => net.ways.some((w) => w.id === r.wayId))).toBe(true);
  });

  it('the junction sits at the shared coordinate', () => {
    expect(net.nodes[0].coord).toEqual([-115.15, 36.1]);
  });

  // Five ways meeting at one node is one junction with five refs, not ten
  // pairwise ones — a real Flamingo Rd sample had a node of degree 5.
  it('five ways at one node produce a single junction', () => {
    const fanOut: OsmWayElement[] = [1, 2, 3, 4, 5].map((n) => ({
      type: 'way',
      id: n,
      tags: { highway: 'residential' },
      nodes: [900, 900 + n],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1 + n / 100, lon: -115.15 },
      ],
    }));
    expect(osmElementsToNetwork(fanOut).nodes).toHaveLength(1);
  });

  it('that junction has five refs', () => {
    const fanOut: OsmWayElement[] = [1, 2, 3, 4, 5].map((n) => ({
      type: 'way',
      id: n,
      tags: { highway: 'residential' },
      nodes: [900, 900 + n],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1 + n / 100, lon: -115.15 },
      ],
    }));
    expect(osmElementsToNetwork(fanOut).nodes[0].refs).toHaveLength(5);
  });

  // The case coordinate matching gets wrong: a tram drawn down a street.
  // Identical coordinates, different node ids — they overlap, they do not join.
  it('identical coordinates with different node ids produce no junction', () => {
    const coLocated: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'residential' },
        nodes: [100, 101],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.1 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { railway: 'tram' },
        nodes: [200, 201],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.1 },
        ],
      },
    ];
    expect(osmElementsToNetwork(coLocated).nodes).toHaveLength(0);
  });

  // A closed way (roundabout, loop road) repeats its first node id last, so
  // that node has two refs from ONE way. It stays a junction deliberately:
  // routeGraph keys vertices by "wayId:pointIndex" through node identity, so
  // sharing the node is what makes the loop actually close in the graph, and
  // it keeps the two ends moving together when either is dragged.
  const closedWay: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      nodes: [100, 101, 102, 100],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1005, lon: -115.15 },
        { lat: 36.1005, lon: -115.1495 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
  ];
  const closedNet = osmElementsToNetwork(closedWay);

  it("a closed way's repeated node still forms a junction", () => {
    expect(closedNet.nodes).toHaveLength(1);
  });

  it("that junction links the way's first and last point", () => {
    expect(closedNet.nodes[0].refs.map((r) => r.pointIndex).sort()).toEqual([0, 3]);
  });

  it('it is one way meeting itself, not two ways', () => {
    expect(new Set(closedNet.nodes[0].refs.map((r) => r.wayId)).size).toBe(1);
  });

  // Unshared node ids are ordinary vertices, not junctions.
  it("a lone way's own vertices produce no junctions", () => {
    const disjoint: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'residential' },
        nodes: [100, 101, 102],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.15 },
          { lat: 36.1, lon: -115.1 },
        ],
      },
    ];
    expect(osmElementsToNetwork(disjoint).nodes).toHaveLength(0);
  });

  // A node shared with a skipped element isn't a junction: the footpath was
  // never imported, so there's nothing on the other side of it.
  it("an unimported element's shared node forms no junction", () => {
    const withSkipped: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'residential' },
        nodes: [100, 500],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.15 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { highway: 'footway' },
        nodes: [500, 201],
        geometry: [
          { lat: 36.1, lon: -115.15 },
          { lat: 36.2, lon: -115.15 },
        ],
      },
    ];
    const skipped = osmElementsToNetwork(withSkipped);
    expect(skipped.ways).toHaveLength(1);
    expect(skipped.nodes).toHaveLength(0);
  });

  // Misaligned nodes/geometry can't be indexed against each other, so the way
  // imports without refs rather than with wrong ones.
  const misaligned: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      nodes: [100, 500],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'residential' },
      nodes: [500], // one id, two points
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.2, lon: -115.15 },
      ],
    },
  ];
  const bad = osmElementsToNetwork(misaligned);

  it('a nodes/geometry length mismatch still imports the way', () => {
    expect(bad.ways).toHaveLength(2);
  });

  it('a nodes/geometry length mismatch contributes no refs', () => {
    expect(bad.nodes).toHaveLength(0);
  });
});

describe('importWays store action appends bare infrastructure, no auto-service', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
    store.getState().setSystem(createEmptySystem());
    const imported: Way[] = [
      {
        id: 'osm-a',
        typeId: 'road',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        profile: defaultProfileFor('road'),
        classId: 'local',
        source: 'osm:123',
      },
      {
        id: 'osm-b',
        typeId: 'road',
        points: [
          [-115.1, 36.1],
          [-115.1, 36.2],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        profile: defaultProfileFor('road'),
        classId: 'local',
        source: 'osm:124',
      },
    ];
    store.getState().importWays({
      ways: imported,
      nodes: [
        {
          id: 'osm-j',
          coord: [-115.1, 36.1],
          refs: [
            { wayId: 'osm-a', pointIndex: 1 },
            { wayId: 'osm-b', pointIndex: 0 },
          ],
        },
      ],
      namedWays: [{ id: 'osm-n', name: 'Imported Avenue', wayIds: ['osm-a', 'osm-b'] }],
      medians: [],
      turnRestrictions: [],
    });
  });

  it('importWays appends the way', () => {
    expect(store.getState().system.ways.some((w) => w.id === 'osm-a')).toBe(true);
  });

  it('importWays creates no service for it (bare infrastructure)', () => {
    expect(store.getState().system.services).toHaveLength(0);
  });

  it('imported way keeps its OSM source marker', () => {
    expect(store.getState().system.ways.find((w) => w.id === 'osm-a')?.source).toBe('osm:123');
  });

  it("importWays appends the import's junctions too", () => {
    expect(store.getState().system.nodes.some((n) => n.id === 'osm-j')).toBe(true);
  });

  it('the appended junction still links both imported ways', () => {
    expect(store.getState().system.nodes.find((n) => n.id === 'osm-j')?.refs).toHaveLength(2);
  });

  // An imported grid arrives connected, so validate() sees a junction rather
  // than an unjoined crossing — the whole point of carrying nodes through.
  it('an imported junction is not flagged as an unjoined crossing', () => {
    expect(validateSystem(store.getState().system).some((i) => i.id.startsWith('crossing-'))).toBe(
      false,
    );
  });
});

describe('crossings at different grades are bridges, not missing junctions', () => {
  it('an elevated way crossing a surface street is not flagged', () => {
    const store = createEditorStore();
    store.getState().setSystem(createEmptySystem());
    const overpass: Way[] = [
      {
        id: 'surface',
        typeId: 'road',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        profile: defaultProfileFor('road'),
      },
      {
        id: 'bridge',
        typeId: 'road',
        points: [
          [-115.15, 36.05],
          [-115.15, 36.15],
        ],
        geometry: 'straight',
        grade: 'elevated',
        profile: defaultProfileFor('road'),
      },
    ];
    store
      .getState()
      .importWays({ ways: overpass, nodes: [], namedWays: [], medians: [], turnRestrictions: [] });
    expect(validateSystem(store.getState().system).some((i) => i.id.startsWith('crossing-'))).toBe(
      false,
    );
  });

  it('the same two ways at one grade are joined into a real junction instead of flagged', () => {
    const store = createEditorStore();
    store.getState().setSystem(createEmptySystem());
    const overpass: Way[] = [
      {
        id: 'surface',
        typeId: 'road',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        profile: defaultProfileFor('road'),
      },
      {
        id: 'bridge',
        typeId: 'road',
        points: [
          [-115.15, 36.05],
          [-115.15, 36.15],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        profile: defaultProfileFor('road'),
      },
    ];
    store.getState().importWays({
      ways: overpass,
      nodes: [],
      namedWays: [],
      medians: [],
      turnRestrictions: [],
    });
    expect(validateSystem(store.getState().system).some((i) => i.id.startsWith('crossing-'))).toBe(
      false,
    );
    expect(store.getState().system.nodes).toHaveLength(1);
  });
});
