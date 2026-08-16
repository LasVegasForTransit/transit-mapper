import { describe, expect, it } from 'vitest';
import {
  buildOverpassQuery,
  classifyOsmWay,
  gradeFromOsmTags,
  osmElementsToNetwork,
  osmElementsToWays,
  profileFromOsmTags,
  type OsmWayElement,
} from '@transitmapper/core/model/import';
import { laneKind, wayType } from '@transitmapper/core/model/catalog';
import {
  defaultProfileFor,
  isOneWay,
  MAX_PRIMARY_LANES,
  wayCapacity,
} from '@transitmapper/core/model/profile';
import { createEditorStore } from '../../src/editor/store';
import { createEmptySystem } from '@transitmapper/core/model/serialize';

describe('OSM import — pure, network-free transforms', () => {
  it('classifyOsmWay maps railway=rail to heavyRail', () => {
    expect(classifyOsmWay({ railway: 'rail' })?.typeId).toBe('heavyRail');
  });

  it('classifyOsmWay maps railway=subway to heavyRail too (same track standard)', () => {
    expect(classifyOsmWay({ railway: 'subway' })?.typeId).toBe('heavyRail');
  });

  it('classifyOsmWay maps railway=tram to lightRail', () => {
    expect(classifyOsmWay({ railway: 'tram' })?.typeId).toBe('lightRail');
  });

  it('classifyOsmWay maps highway=primary to a road with arterial class', () => {
    expect(classifyOsmWay({ highway: 'primary' })).toMatchObject({
      typeId: 'road',
      classId: 'arterial',
    });
  });

  it('classifyOsmWay maps highway=cycleway to bike', () => {
    expect(classifyOsmWay({ highway: 'cycleway' })?.typeId).toBe('bike');
  });

  it('classifyOsmWay returns null for an uninteresting tag set', () => {
    expect(classifyOsmWay({ building: 'yes' })).toBeNull();
  });

  it('classifyOsmWay returns null with no tags at all', () => {
    expect(classifyOsmWay(undefined)).toBeNull();
  });

  it('buildOverpassQuery embeds the bounding box', () => {
    const query = buildOverpassQuery({ west: -115.3, south: 36.0, east: -115.0, north: 36.2 }, [
      'road',
      'lightRail',
    ]);
    expect(query).toContain('36,-115.3,36.2,-115');
  });

  it('buildOverpassQuery only includes requested categories', () => {
    const query = buildOverpassQuery({ west: -115.3, south: 36.0, east: -115.0, north: 36.2 }, [
      'road',
      'lightRail',
    ]);
    expect(query).toContain('highway');
    expect(query).toContain('light_rail');
    expect(query).not.toContain('"railway"~"^(rail|subway)$"');
  });

  // Annotated rather than inferred: mixing tag shapes across the array makes
  // tsc widen each `tags` to a union with optional-undefined members, which
  // doesn't satisfy OsmWayElement's Record<string, string>.
  const elements: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.11, lon: -115.19 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { railway: 'tram' },
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.12, lon: -115.18 },
      ],
    },
    {
      type: 'way',
      id: 3,
      tags: { building: 'yes' },
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.11, lon: -115.19 },
      ],
    }, // filtered out
    {
      type: 'way',
      id: 4,
      tags: { highway: 'residential' },
      geometry: [{ lat: 36.1, lon: -115.2 }],
    }, // filtered out: single point
    { type: 'node', id: 5, tags: { highway: 'residential' } }, // filtered out: not a way
  ];
  const ways = osmElementsToWays(elements);

  it('osmElementsToWays keeps only recognized, ≥2-point ways', () => {
    expect(ways).toHaveLength(2);
  });

  it('osmElementsToWays tags each way with its OSM source', () => {
    expect(ways.map((w) => w.source)).toEqual(['osm:1', 'osm:2']);
  });

  it('osmElementsToWays preserves [lon,lat] → LngLat point order', () => {
    expect(ways[0].points[0]).toEqual([-115.2, 36.1]);
  });

  it('osmElementsToWays assigns the residential road its local class', () => {
    expect(ways[0]).toMatchObject({ typeId: 'road', classId: 'local' });
  });

  it("osmElementsToWays defaults capacity from the way type's catalog default", () => {
    expect(wayCapacity(ways[1])).toBe(wayType('lightRail').defaultCapacity);
  });

  it('osmElementsToWays yields no junctions when elements carry no node ids', () => {
    expect(osmElementsToNetwork(elements).nodes).toHaveLength(0);
  });
});

describe("OSM import reads OSM's own lane tagging, not the type default", () => {
  const lanesOf = (p: ReturnType<typeof profileFromOsmTags>) =>
    p.lanes.filter((l) => laneKind(l.kindId).role === 'travel' && l.kindId !== 'sidewalk');
  const dirs = (p: ReturnType<typeof profileFromOsmTags>) => lanesOf(p).map((l) => l.direction);
  const kinds = (p: ReturnType<typeof profileFromOsmTags>) => lanesOf(p).map((l) => l.kindId);
  const sw = (p: ReturnType<typeof profileFromOsmTags>) =>
    p.lanes.filter((l) => l.kindId === 'sidewalk').length;

  // The complaint that motivated this: a one-way carriageway imported as a
  // two-way street, so a divided road drew two yellow centre lines.
  it('oneway=yes imports as a one-way profile', () => {
    const oneWay = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      oneway: 'yes',
      lanes: '3',
    });
    expect(isOneWay(oneWay)).toBe(true);
  });

  it('oneway=yes honours the lanes count', () => {
    const oneWay = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      oneway: 'yes',
      lanes: '3',
    });
    expect(lanesOf(oneWay)).toHaveLength(3);
  });

  it('oneway=yes runs every lane forward', () => {
    const oneWay = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      oneway: 'yes',
      lanes: '3',
    });
    expect(dirs(oneWay)).toEqual(['forward', 'forward', 'forward']);
  });

  it("oneway=-1 runs against the way's direction", () => {
    const reverseOneWay = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      oneway: '-1',
      lanes: '2',
    });
    expect(dirs(reverseOneWay)).toEqual(['backward', 'backward']);
  });

  // A two-way street splits per OSM, not evenly, when OSM says so.
  it('lanes:forward/backward drive the split', () => {
    const split = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      lanes: '5',
      'lanes:forward': '3',
      'lanes:backward': '2',
    });
    expect(dirs(split)).toEqual(['backward', 'backward', 'forward', 'forward', 'forward']);
  });

  it('a directional tag on one side infers the other from lanes', () => {
    const inferred = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      lanes: '4',
      'lanes:backward': '1',
    });
    expect(dirs(inferred)).toEqual(['backward', 'forward', 'forward', 'forward']);
  });

  // lanes counts the shared centre lane, so it must not also become a travel lane.
  it('lanes:both_ways becomes a centre turn pocket', () => {
    const centre = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      lanes: '5',
      'lanes:both_ways': '1',
    });
    expect(kinds(centre)).toEqual(['drive', 'drive', 'turnPocket', 'drive', 'drive']);
  });

  // turn:lanes, left-to-right as the driver sees them.
  it('turn:lanes marks turn-only lanes as pockets', () => {
    const turns = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      oneway: 'yes',
      lanes: '4',
      'turn:lanes': 'left|through|through|right',
    });
    expect(kinds(turns)).toEqual(['turnPocket', 'drive', 'drive', 'turnPocket']);
  });

  it('a through;right lane stays a travel lane', () => {
    const combo = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      oneway: 'yes',
      lanes: '2',
      'turn:lanes': 'through;right|right',
    });
    expect(kinds(combo)).toEqual(['drive', 'turnPocket']);
  });

  it("a turn:lanes count that doesn't match the lanes is ignored", () => {
    const mismatched = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      oneway: 'yes',
      lanes: '3',
      'turn:lanes': 'left|through',
    });
    expect(kinds(mismatched)).toEqual(['drive', 'drive', 'drive']);
  });

  // Backward lanes are stored left-to-right facing forward, so the driver's
  // left is the rightmost of them — the entry order maps on reversed.
  it('turn:lanes:backward maps on reversed', () => {
    const backTurns = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      lanes: '4',
      'lanes:forward': '2',
      'lanes:backward': '2',
      'turn:lanes:backward': 'left|through',
    });
    expect(kinds(backTurns)).toEqual(['drive', 'turnPocket', 'drive', 'drive']);
  });

  // Class-aware fallback: without a lanes tag a local street is not an arterial.
  it('an untagged local street falls back to two lanes', () => {
    const local = profileFromOsmTags('road', 'local', { highway: 'residential' });
    expect(lanesOf(local)).toHaveLength(2);
  });

  it('an untagged arterial still falls back to four', () => {
    const arterial = profileFromOsmTags('road', 'arterial', { highway: 'primary' });
    expect(lanesOf(arterial)).toHaveLength(4);
  });

  it("an untagged one-way street takes one carriageway's worth", () => {
    expect(
      lanesOf(profileFromOsmTags('road', 'arterial', { highway: 'primary', oneway: 'yes' })),
    ).toHaveLength(2);
  });

  // Sidewalks OSM says aren't there shouldn't be invented.
  it("the catalog's sidewalks stay when OSM is silent", () => {
    expect(sw(profileFromOsmTags('road', 'arterial', { highway: 'primary' }))).toBe(2);
  });

  it('sidewalk:left=no drops one side', () => {
    expect(
      sw(profileFromOsmTags('road', 'arterial', { highway: 'primary', 'sidewalk:left': 'no' })),
    ).toBe(1);
  });

  it('sidewalk=no drops both', () => {
    expect(sw(profileFromOsmTags('road', 'arterial', { highway: 'primary', sidewalk: 'no' }))).toBe(
      0,
    );
  });

  it('sidewalk:right=separate drops the side mapped elsewhere', () => {
    expect(
      sw(
        profileFromOsmTags('road', 'arterial', {
          highway: 'primary',
          'sidewalk:right': 'separate',
        }),
      ),
    ).toBe(1);
  });

  // Hostile / malformed values fall back rather than allocating.
  it('a non-numeric lanes tag falls back to the class default', () => {
    expect(
      lanesOf(profileFromOsmTags('road', 'local', { highway: 'residential', lanes: 'lots' })),
    ).toHaveLength(2);
  });

  it('an absurd lanes tag is clamped', () => {
    expect(
      lanesOf(profileFromOsmTags('road', 'arterial', { highway: 'primary', lanes: '1e999' }))
        .length,
    ).toBeLessThanOrEqual(MAX_PRIMARY_LANES);
  });

  // Each tag clamps on its own, so the TOTAL is what needs holding: two
  // clamped directional tags used to allocate 64 lanes between them.
  it('two absurd directional tags are clamped in total, not each', () => {
    const bothAbsurd = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      'lanes:forward': '999',
      'lanes:backward': '999',
    });
    expect(lanesOf(bothAbsurd).length).toBeLessThanOrEqual(MAX_PRIMARY_LANES);
  });

  it('clamping an over-large split keeps both directions', () => {
    const bothAbsurd = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      'lanes:forward': '999',
      'lanes:backward': '999',
    });
    expect(new Set(lanesOf(bothAbsurd).map((l) => l.direction)).size).toBe(2);
  });

  it('the centre turn lane counts against the ceiling too', () => {
    const absurdWithCentre = profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      'lanes:forward': '999',
      'lanes:backward': '999',
      'lanes:both_ways': '1',
    });
    expect(
      absurdWithCentre.lanes.filter((l) => l.kindId !== 'sidewalk').length,
    ).toBeLessThanOrEqual(MAX_PRIMARY_LANES);
  });

  it("clamping preserves a lopsided split's shape", () => {
    const lopsided = lanesOf(
      profileFromOsmTags('road', 'arterial', {
        highway: 'primary',
        'lanes:forward': '30',
        'lanes:backward': '10',
      }),
    );
    const forwardCount = lopsided.filter((l) => l.direction === 'forward').length;
    const backwardCount = lopsided.filter((l) => l.direction === 'backward').length;
    expect(lopsided.length).toBeLessThanOrEqual(MAX_PRIMARY_LANES);
    expect(forwardCount).toBeGreaterThan(backwardCount);
    expect(backwardCount).toBeGreaterThanOrEqual(1);
  });

  // Rail and bike keep their catalog defaults — lanes is road vocabulary.
  it('a tram way ignores road lane tags', () => {
    expect(
      profileFromOsmTags('lightRail', undefined, { railway: 'tram', lanes: '4' }).lanes.length,
    ).toBe(defaultProfileFor('lightRail').lanes.length);
  });

  // And the whole thing flows through the real import path.
  it('osmElementsToNetwork applies the tag-derived profile', () => {
    const tagged: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'primary', oneway: 'yes', lanes: '3' },
        nodes: [1, 2],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.1 },
        ],
      },
    ];
    expect(isOneWay(osmElementsToNetwork(tagged).ways[0].profile)).toBe(true);
  });
});

describe('OSM import reads bike lanes tagged on the roadway', () => {
  const kinds = (p: ReturnType<typeof profileFromOsmTags>) => p.lanes.map((l) => l.kindId);
  const base = { highway: 'secondary', lanes: '2' };

  it('no cycleway tag means no bike lane', () => {
    expect(kinds(profileFromOsmTags('road', 'arterial', base))).not.toContain('bike');
  });

  it('cycleway=lane puts a bike lane at both kerbs', () => {
    expect(kinds(profileFromOsmTags('road', 'arterial', { ...base, cycleway: 'lane' }))).toEqual([
      'sidewalk',
      'bike',
      'drive',
      'drive',
      'bike',
      'sidewalk',
    ]);
  });

  it('cycleway:right=track is read as a bike lane too', () => {
    expect(
      kinds(profileFromOsmTags('road', 'arterial', { ...base, 'cycleway:right': 'track' })),
    ).toEqual(['sidewalk', 'drive', 'drive', 'bike', 'sidewalk']);
  });

  // The cycleway is its own way in OSM, and imports as one — drawing a lane
  // here as well would render the same bike infrastructure twice.
  it('cycleway=separate adds no lane', () => {
    expect(
      kinds(profileFromOsmTags('road', 'arterial', { ...base, cycleway: 'separate' })),
    ).not.toContain('bike');
  });

  it('cycleway=no adds no lane', () => {
    expect(
      kinds(profileFromOsmTags('road', 'arterial', { ...base, cycleway: 'no' })),
    ).not.toContain('bike');
  });

  it('share_busway is bikes in the bus lane, not a lane of its own', () => {
    expect(
      kinds(profileFromOsmTags('road', 'arterial', { ...base, cycleway: 'share_busway' })),
    ).not.toContain('bike');
  });

  it('a bike lane does not consume a travel lane', () => {
    expect(
      profileFromOsmTags('road', 'arterial', { ...base, cycleway: 'lane' }).lanes.filter(
        (l) => l.kindId === 'drive',
      ),
    ).toHaveLength(2);
  });

  // Kerb outwards-in: parking, then bike, then bus, then the travel lanes.
  it('the kerb-inwards order is parking, bike, bus', () => {
    expect(
      kinds(
        profileFromOsmTags('road', 'arterial', {
          ...base,
          'parking:lane:right': 'parallel',
          'cycleway:right': 'lane',
          'busway:right': 'lane',
        }),
      ),
    ).toEqual(['sidewalk', 'drive', 'drive', 'bus', 'bike', 'parking', 'sidewalk']);
  });
});

describe('OSM import reads on-street parking', () => {
  const kinds = (p: ReturnType<typeof profileFromOsmTags>) => p.lanes.map((l) => l.kindId);
  const base = { highway: 'residential', lanes: '2' };

  it('no parking tag means no parking lane', () => {
    expect(kinds(profileFromOsmTags('road', 'local', base))).not.toContain('parking');
  });

  it('the older parking:lane scheme is read', () => {
    expect(
      kinds(profileFromOsmTags('road', 'local', { ...base, 'parking:lane:both': 'parallel' })),
    ).toEqual(['sidewalk', 'parking', 'drive', 'drive', 'parking', 'sidewalk']);
  });

  it('the newer parking:<side> scheme is read too', () => {
    expect(
      kinds(profileFromOsmTags('road', 'local', { ...base, 'parking:right': 'lane' })),
    ).toEqual(['sidewalk', 'drive', 'drive', 'parking', 'sidewalk']);
  });

  it('parking:lane:both=no adds nothing', () => {
    expect(
      kinds(profileFromOsmTags('road', 'local', { ...base, 'parking:lane:both': 'no' })),
    ).not.toContain('parking');
  });

  it('no_stopping is not parking', () => {
    expect(
      kinds(profileFromOsmTags('road', 'local', { ...base, 'parking:lane:left': 'no_stopping' })),
    ).not.toContain('parking');
  });

  it('parking is stationary, so it has no direction', () => {
    const parkingLanes = profileFromOsmTags('road', 'local', {
      ...base,
      'parking:lane:both': 'parallel',
    }).lanes.filter((l) => l.kindId === 'parking');
    expect(parkingLanes.map((l) => l.direction)).toEqual(['none', 'none']);
  });

  it('parking does not consume a travel lane', () => {
    expect(
      profileFromOsmTags('road', 'local', {
        ...base,
        'parking:lane:both': 'parallel',
      }).lanes.filter((l) => l.kindId === 'drive'),
    ).toHaveLength(2);
  });

  // Kerb outwards-in: parking is outboard of a bus lane on the same side.
  it('parking sits outboard of a bus lane on the same side', () => {
    expect(
      kinds(
        profileFromOsmTags('road', 'arterial', {
          ...base,
          'parking:lane:right': 'parallel',
          'busway:right': 'lane',
        }),
      ),
    ).toEqual(['sidewalk', 'drive', 'drive', 'bus', 'parking', 'sidewalk']);
  });
});

describe('OSM import reads bus lanes', () => {
  const kinds = (p: ReturnType<typeof profileFromOsmTags>) => p.lanes.map((l) => l.kindId);
  const dirOf = (p: ReturnType<typeof profileFromOsmTags>, kindId: string) =>
    p.lanes.filter((l) => l.kindId === kindId).map((l) => l.direction);

  it('no busway tag means no bus lane', () => {
    expect(
      kinds(profileFromOsmTags('road', 'arterial', { highway: 'primary', lanes: '2' })),
    ).not.toContain('bus');
  });

  it('busway=lane puts a bus lane on both kerbs', () => {
    expect(
      kinds(
        profileFromOsmTags('road', 'arterial', { highway: 'primary', lanes: '2', busway: 'lane' }),
      ),
    ).toEqual(['sidewalk', 'bus', 'drive', 'drive', 'bus', 'sidewalk']);
  });

  it('busway:right=lane puts one on the right only', () => {
    expect(
      kinds(
        profileFromOsmTags('road', 'arterial', {
          highway: 'primary',
          lanes: '2',
          'busway:right': 'lane',
        }),
      ),
    ).toEqual(['sidewalk', 'drive', 'drive', 'bus', 'sidewalk']);
  });

  it('a side-specific tag beats the both-sides one', () => {
    expect(
      kinds(
        profileFromOsmTags('road', 'arterial', {
          highway: 'primary',
          lanes: '2',
          busway: 'lane',
          'busway:left': 'no',
        }),
      ),
    ).toEqual(['sidewalk', 'drive', 'drive', 'bus', 'sidewalk']);
  });

  it('busway=no adds nothing', () => {
    expect(
      kinds(
        profileFromOsmTags('road', 'arterial', { highway: 'primary', lanes: '2', busway: 'no' }),
      ),
    ).not.toContain('bus');
  });

  it('a bus lane runs with the traffic beside it', () => {
    expect(
      dirOf(
        profileFromOsmTags('road', 'arterial', { highway: 'primary', lanes: '2', busway: 'lane' }),
        'bus',
      ),
    ).toEqual(['backward', 'forward']);
  });

  it("on a one-way street both bus lanes run the way's direction", () => {
    expect(
      dirOf(
        profileFromOsmTags('road', 'arterial', {
          highway: 'primary',
          oneway: 'yes',
          lanes: '2',
          busway: 'lane',
        }),
        'bus',
      ),
    ).toEqual(['forward', 'forward']);
  });

  // Bus lanes are additional to `lanes`, not carved out of it.
  it('a bus lane does not consume a travel lane', () => {
    expect(
      profileFromOsmTags('road', 'arterial', {
        highway: 'primary',
        lanes: '4',
        busway: 'lane',
      }).lanes.filter((l) => l.kindId === 'drive'),
    ).toHaveLength(4);
  });

  // busway:right names the way's right-hand side in every country, so the
  // lane stays at that kerb; only the two travel lanes swap direction order.
  it('a bus lane keeps its tagged kerb under left-hand traffic', () => {
    expect(
      kinds(
        profileFromOsmTags(
          'road',
          'arterial',
          { highway: 'primary', lanes: '2', 'busway:right': 'lane' },
          'left',
        ),
      ),
    ).toEqual(['sidewalk', 'drive', 'drive', 'bus', 'sidewalk']);
  });
});

describe("OSM import places lanes for the system's driving side", () => {
  const kinds = (p: ReturnType<typeof profileFromOsmTags>) =>
    p.lanes.map((l) => `${l.kindId}:${l.direction}`);
  const tags = { highway: 'primary', lanes: '4' };

  it('right-hand traffic keeps backward lanes on the left', () => {
    const right = profileFromOsmTags('road', 'arterial', tags, 'right');
    expect(kinds(right)).toEqual([
      'sidewalk:both',
      'drive:backward',
      'drive:backward',
      'drive:forward',
      'drive:forward',
      'sidewalk:both',
    ]);
  });

  it('left-hand traffic puts forward lanes on the left', () => {
    const left = profileFromOsmTags('road', 'arterial', tags, 'left');
    expect(kinds(left)).toEqual([
      'sidewalk:both',
      'drive:forward',
      'drive:forward',
      'drive:backward',
      'drive:backward',
      'sidewalk:both',
    ]);
  });

  it('right-hand traffic is still the default', () => {
    const right = profileFromOsmTags('road', 'arterial', tags, 'right');
    expect(kinds(profileFromOsmTags('road', 'arterial', tags))).toEqual(kinds(right));
  });

  // OSM's :left/:right are relative to the WAY's forward direction in every
  // country, so a tagged side must not move with the driving side. A one-way
  // street is the decisive case: every lane runs the same way, so there is no
  // direction arrangement to swap, and anything that moves has been misplaced.
  it('a tagged kerb lane stays on that kerb under left-hand traffic', () => {
    const oneWayBus = { highway: 'primary', oneway: 'yes', lanes: '3', 'busway:left': 'lane' };
    expect(kinds(profileFromOsmTags('road', 'arterial', oneWayBus, 'left'))).toEqual(
      kinds(profileFromOsmTags('road', 'arterial', oneWayBus, 'right')),
    );
  });

  it('and it really is the left kerb', () => {
    const oneWayBus = { highway: 'primary', oneway: 'yes', lanes: '3', 'busway:left': 'lane' };
    expect(profileFromOsmTags('road', 'arterial', oneWayBus, 'left').lanes[1].kindId).toBe('bus');
  });

  it('sidewalk:left=no drops the left sidewalk under RHT', () => {
    const oneSidewalk = { highway: 'primary', lanes: '2', 'sidewalk:left': 'no' };
    const swRight = profileFromOsmTags('road', 'arterial', oneSidewalk, 'right');
    expect(swRight.lanes[0].kindId).not.toBe('sidewalk');
    expect(swRight.lanes[swRight.lanes.length - 1].kindId).toBe('sidewalk');
  });

  it('and drops the same one under LHT', () => {
    const oneSidewalk = { highway: 'primary', lanes: '2', 'sidewalk:left': 'no' };
    const swLeft = profileFromOsmTags('road', 'arterial', oneSidewalk, 'left');
    expect(swLeft.lanes[0].kindId).not.toBe('sidewalk');
    expect(swLeft.lanes[swLeft.lanes.length - 1].kindId).toBe('sidewalk');
  });

  // Split from a single loop-generated check() (one source call, 3 tags) into
  // one it.each case per tag, since each iteration asserts a distinct named fact.
  it.each([
    ['cycleway:left', 'lane'],
    ['parking:lane:left', 'parallel'],
    ['busway:left', 'lane'],
  ] as const)('%s lands on the same physical side under either driving side', (tag, value) => {
    const t = { highway: 'primary', lanes: '2', [tag]: value } as Record<string, string>;
    const sideOf = (p: ReturnType<typeof profileFromOsmTags>) =>
      kinds(p).findIndex((x) => !x.startsWith('sidewalk') && !x.startsWith('drive'));
    expect(sideOf(profileFromOsmTags('road', 'arterial', t, 'left'))).toBe(
      sideOf(profileFromOsmTags('road', 'arterial', t, 'right')),
    );
  });

  // turn:lanes is likewise ordered by the driver's own direction of travel.
  const oneWayTurns = {
    highway: 'primary',
    oneway: 'yes',
    lanes: '3',
    'turn:lanes': 'left|through|through',
  };
  const pocketAt = (side: 'left' | 'right') =>
    profileFromOsmTags('road', 'arterial', oneWayTurns, side).lanes.findIndex(
      (l) => l.kindId === 'turnPocket',
    );

  it("a one-way street's turn pocket does not move with the driving side", () => {
    expect(pocketAt('left')).toBe(pocketAt('right'));
  });

  it("and it is the driver's leftmost lane", () => {
    expect(pocketAt('right')).toBe(1);
  });

  // A two-way street's blocks DO swap, and each block keeps its own ordering.
  it('under RHT the forward block sits on the right', () => {
    const twoWayTurns = {
      highway: 'primary',
      lanes: '4',
      'lanes:forward': '2',
      'lanes:backward': '2',
      'turn:lanes:forward': 'left|through',
    };
    const twRight = profileFromOsmTags('road', 'arterial', twoWayTurns, 'right');
    expect(twRight.lanes[3].direction).toBe('forward');
  });

  it('under LHT the forward block sits on the left', () => {
    const twoWayTurns = {
      highway: 'primary',
      lanes: '4',
      'lanes:forward': '2',
      'lanes:backward': '2',
      'turn:lanes:forward': 'left|through',
    };
    const twLeft = profileFromOsmTags('road', 'arterial', twoWayTurns, 'left');
    expect(twLeft.lanes[1].direction).toBe('forward');
  });

  it("the forward block's turn pocket stays its own leftmost lane", () => {
    const twoWayTurns = {
      highway: 'primary',
      lanes: '4',
      'lanes:forward': '2',
      'lanes:backward': '2',
      'turn:lanes:forward': 'left|through',
    };
    const twRight = profileFromOsmTags('road', 'arterial', twoWayTurns, 'right');
    const twLeft = profileFromOsmTags('road', 'arterial', twoWayTurns, 'left');
    const fwdPocket = (p: ReturnType<typeof profileFromOsmTags>) =>
      p.lanes.findIndex((l) => l.kindId === 'turnPocket');
    expect(twRight.lanes[fwdPocket(twRight)].direction).toBe('forward');
    expect(twLeft.lanes[fwdPocket(twLeft)].direction).toBe('forward');
  });

  // And it flows through the real entry point.
  it('osmElementsToNetwork honours the driving side', () => {
    const left = profileFromOsmTags('road', 'arterial', tags, 'left');
    const el: OsmWayElement[] = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'primary', lanes: '4' },
        nodes: [1, 2],
        geometry: [
          { lat: 36.1, lon: -115.2 },
          { lat: 36.1, lon: -115.1 },
        ],
      },
    ];
    expect(kinds(osmElementsToNetwork(el, 'left').ways[0].profile)).toEqual(kinds(left));
  });
});

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

  // Junction control comes from OSM node elements, matched by node id.
  const controlled: OsmWayElement[] = [
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
