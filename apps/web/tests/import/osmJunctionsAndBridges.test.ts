import { beforeEach, describe, expect, it } from 'vitest';
import { osmElementsToNetwork, type OsmWayElement } from '@transitmapper/core/model/import';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { validateSystem } from '@transitmapper/core/model/validate';
import { createEditorStore } from '../../src/editor/store';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { Way } from '@transitmapper/core/model/system';

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
  const fiveWayFanOut = (): OsmWayElement[] =>
    [1, 2, 3, 4, 5].map((n) => ({
      type: 'way',
      id: n,
      tags: { highway: 'residential' },
      nodes: [900, 900 + n],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1 + n / 100, lon: -115.15 },
      ],
    }));

  it('five ways at one node produce a single junction', () => {
    expect(osmElementsToNetwork(fiveWayFanOut()).nodes).toHaveLength(1);
  });

  it('that junction has five refs', () => {
    expect(osmElementsToNetwork(fiveWayFanOut()).nodes[0].refs).toHaveLength(5);
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
    store.commands.document.setSystem(createEmptySystem());
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
    store.commands.imports.importWays({
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
  // A surface street crossed by a second way whose grade varies per test: at
  // 'elevated' it's a bridge overhead, at 'atGrade' it's the same junction.
  const importCrossing = (bridgeGrade: Way['grade']) => {
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
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
        grade: bridgeGrade,
        profile: defaultProfileFor('road'),
      },
    ];
    store.commands.imports.importWays({
      ways: overpass,
      nodes: [],
      namedWays: [],
      medians: [],
      turnRestrictions: [],
    });
    return store;
  };

  it('an elevated way crossing a surface street is not flagged', () => {
    const store = importCrossing('elevated');
    expect(validateSystem(store.getState().system).some((i) => i.id.startsWith('crossing-'))).toBe(
      false,
    );
  });

  it('the same two ways at one grade are joined into a real junction instead of flagged', () => {
    const store = importCrossing('atGrade');
    expect(validateSystem(store.getState().system).some((i) => i.id.startsWith('crossing-'))).toBe(
      false,
    );
    expect(store.getState().system.nodes).toHaveLength(1);
  });
});
