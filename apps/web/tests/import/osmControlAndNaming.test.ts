import { describe, expect, it } from 'vitest';
import {
  buildOverpassQuery,
  gradeFromOsmTags,
  osmElementsToNetwork,
  type OsmWayElement,
} from '@transitmapper/core/model/import';
import { createEditorStore } from '../../src/editor/store';
import { createEmptySystem } from '@transitmapper/core/model/serialize';

describe('OSM import reads grade and junction control', () => {
  it('no grade tags means at grade', () => {
    expect(gradeFromOsmTags({ highway: 'primary' })).toBe('atGrade');
  });

  it('bridge=yes is elevated', () => {
    expect(gradeFromOsmTags({ bridge: 'yes' })).toBe('elevated');
  });

  it('tunnel=yes is underground', () => {
    expect(gradeFromOsmTags({ tunnel: 'yes' })).toBe('underground');
  });

  it('bridge=no is not a bridge', () => {
    expect(gradeFromOsmTags({ bridge: 'no' })).toBe('atGrade');
  });

  it('a positive layer alone is elevated', () => {
    expect(gradeFromOsmTags({ layer: '2' })).toBe('elevated');
  });

  it('a negative layer alone is underground', () => {
    expect(gradeFromOsmTags({ layer: '-1' })).toBe('underground');
  });

  it('layer=0 is at grade', () => {
    expect(gradeFromOsmTags({ layer: '0' })).toBe('atGrade');
  });

  it('tunnel wins over a positive layer', () => {
    expect(gradeFromOsmTags({ tunnel: 'yes', layer: '1' })).toBe('underground');
  });

  // A plain two-way primary crossroads, factored out because several specs
  // below layer a different control node onto the same shared node id, 500.
  const primaryWay = (
    id: number,
    nodes: [number, number],
    geometry: [{ lat: number; lon: number }, { lat: number; lon: number }],
  ): OsmWayElement => ({ type: 'way', id, tags: { highway: 'primary' }, nodes, geometry });
  const crossroad = (): OsmWayElement[] => [
    primaryWay(
      1,
      [10, 500],
      [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
      ],
    ),
    primaryWay(
      2,
      [500, 11],
      [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    ),
  ];

  // Junction control comes from OSM node elements, matched by node id.
  const controlled: OsmWayElement[] = [
    ...crossroad(),
    { type: 'node', id: 500, tags: { highway: 'traffic_signals' } },
  ];

  it('a traffic_signals node controls its junction', () => {
    expect(osmElementsToNetwork(controlled).nodes[0]?.control).toBe('signal');
  });

  it('a control node is not itself imported as a way', () => {
    expect(osmElementsToNetwork(controlled).ways).toHaveLength(2);
  });

  it('a stop node controls its junction', () => {
    const stopTagged: OsmWayElement[] = [
      ...controlled.slice(0, 2),
      { type: 'node', id: 500, tags: { highway: 'stop' } },
    ];
    expect(osmElementsToNetwork(stopTagged).nodes[0]?.control).toBe('stop');
  });

  it('a junction with no control node stays uncontrolled', () => {
    const uncontrolled: OsmWayElement[] = controlled.slice(0, 2);
    expect(osmElementsToNetwork(uncontrolled).nodes[0]?.control).toBeUndefined();
  });

  // junction=roundabout is a way tag, so its junctions inherit it.
  const roundabout: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', junction: 'roundabout' },
      nodes: [500, 501],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.101, lon: -115.15 },
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

  it('a roundabout way marks its junctions as roundabouts', () => {
    expect(osmElementsToNetwork(roundabout).nodes[0]?.control).toBe('roundabout');
  });

  it('an explicit signal beats the roundabout inferred from the way', () => {
    const signalledRoundabout: OsmWayElement[] = [
      ...roundabout,
      { type: 'node', id: 500, tags: { highway: 'traffic_signals' } },
    ];
    expect(osmElementsToNetwork(signalledRoundabout).nodes[0]?.control).toBe('signal');
  });

  // The case real OSM data actually produces: the signal sits at the stop
  // line partway along one approach, not on the shared junction node. ~35m
  // west of the junction at -115.15.
  const stopLine: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary' },
      nodes: [10, 900, 500],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.1504 },
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
    { type: 'node', id: 900, tags: { highway: 'traffic_signals' } },
  ];

  it('a stop-line signal controls the junction it approaches', () => {
    expect(osmElementsToNetwork(stopLine).nodes[0]?.control).toBe('signal');
  });

  it('the stop-line node itself is not a junction', () => {
    expect(osmElementsToNetwork(stopLine).nodes).toHaveLength(1);
  });

  // Too far back to be this junction's stop line (~900m).
  it('a signal far from any junction controls nothing', () => {
    const distant: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'primary' },
        nodes: [10, 900, 500],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.16 },
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
      { type: 'node', id: 900, tags: { highway: 'traffic_signals' } },
    ];
    expect(osmElementsToNetwork(distant).nodes[0]?.control).toBeUndefined();
  });

  // A signal on one carriageway must not reach the parallel one ~17m away,
  // which is why the search walks the way instead of measuring straight-line.
  it('a signal does not reach a junction on the neighbouring carriageway', () => {
    const parallel: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'primary', oneway: 'yes' },
        nodes: [10, 900],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.1504 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { highway: 'primary', oneway: 'yes' },
        nodes: [20, 500],
        geometry: [
          { lat: 36.10015, lon: -115.2 },
          { lat: 36.10015, lon: -115.15 },
        ],
      },
      {
        type: 'way',
        id: 3,
        tags: { highway: 'primary' },
        nodes: [500, 21],
        geometry: [
          { lat: 36.10015, lon: -115.15 },
          { lat: 36.101, lon: -115.15 },
        ],
      },
      { type: 'node', id: 900, tags: { highway: 'traffic_signals' } },
    ];
    expect(osmElementsToNetwork(parallel).nodes.map((n) => n.control)).toEqual([undefined]);
  });

  it('the query asks for control nodes when importing streets', () => {
    expect(
      buildOverpassQuery({ west: -115.3, south: 36, east: -115, north: 36.2 }, ['road']),
    ).toContain('traffic_signals');
  });

  it("the query leaves control nodes out when streets aren't wanted", () => {
    expect(
      buildOverpassQuery({ west: -115.3, south: 36, east: -115, north: 36.2 }, ['heavyRail']),
    ).not.toContain('traffic_signals');
  });
});

describe('OSM import gives imported streets their real names', () => {
  // OSM splits one street into many ways sharing a name — exactly NamedWay.
  const named: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', name: 'West Flamingo Road' },
      nodes: [1, 2],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary', name: 'West Flamingo Road' },
      nodes: [2, 3],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 3,
      tags: { highway: 'residential', name: 'Audrie Street' },
      nodes: [4, 5],
      geometry: [
        { lat: 36.2, lon: -115.2 },
        { lat: 36.2, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 4,
      tags: { highway: 'residential' },
      nodes: [6, 7],
      geometry: [
        { lat: 36.3, lon: -115.2 },
        { lat: 36.3, lon: -115.1 },
      ],
    },
  ];
  const namedNet = osmElementsToNetwork(named);

  it('ways sharing a name become one NamedWay', () => {
    expect(namedNet.namedWays).toHaveLength(1);
  });

  it("the NamedWay takes OSM's name", () => {
    expect(namedNet.namedWays[0].name).toBe('West Flamingo Road');
  });

  it("the NamedWay spans both of that street's ways", () => {
    expect(namedNet.namedWays[0].wayIds).toHaveLength(2);
  });

  it('a name on a single way needs no shared identity', () => {
    expect(namedNet.namedWays.map((n) => n.name)).not.toContain('Audrie Street');
  });

  // A street and a tram line can share a name without being one facility.
  it('a road and a tram sharing a name stay separate identities', () => {
    const sameName: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [1, 2],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.1 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { railway: 'tram', name: 'Main Street' },
        nodes: [3, 4],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.1 },
        ],
      },
    ];
    expect(osmElementsToNetwork(sameName).namedWays).toHaveLength(0);
  });

  it("importWays appends the import's street identities", () => {
    const store = createEditorStore();
    store.getState().setSystem(createEmptySystem());
    store.getState().importWays(osmElementsToNetwork(named));
    expect(store.getState().system.namedWays).toHaveLength(1);
  });
});
