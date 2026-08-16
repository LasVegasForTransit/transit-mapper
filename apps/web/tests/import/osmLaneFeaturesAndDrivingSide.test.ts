import { describe, expect, it } from 'vitest';
import {
  osmElementsToNetwork,
  profileFromOsmTags,
  type OsmWayElement,
} from '@transitmapper/core/model/import';

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
