import { beforeEach, describe, expect, it } from 'vitest';
import {
  osmElementsToNetwork,
  withoutAlreadyImported,
  type OsmWayElement,
} from '@transitmapper/core/model/import';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { createEditorStore } from '../../src/editor/store';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { Node, Way } from '@transitmapper/core/model/system';

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

  // A two-way "Main Street" fixture reused across the named-way merge specs
  // below, each of which needs the array, the first-import result, or both.
  const namedMainStreetArea = (): OsmWayElement[] => [
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
  const importNamedMainStreet = () =>
    withoutAlreadyImported(osmElementsToNetwork(namedMainStreetArea()), []);

  // Street identities follow the same rule as junctions.
  describe('street identities follow the same rule as junctions', () => {
    const namedArea = namedMainStreetArea();
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
    const namedArea = namedMainStreetArea();
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
    const namedFirst = importNamedMainStreet();
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
    const namedArea = namedMainStreetArea();
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
