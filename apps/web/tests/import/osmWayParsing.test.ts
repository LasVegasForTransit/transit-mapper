import { describe, expect, it } from 'vitest';
import {
  buildOverpassQuery,
  classifyOsmWay,
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

describe("OSM import turns a way's raw tags into its type, class, and lane profile", () => {
  describe('pure, network-free transforms', () => {
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

  describe("reads OSM's own lane tagging, not the type default", () => {
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
      expect(
        sw(profileFromOsmTags('road', 'arterial', { highway: 'primary', sidewalk: 'no' })),
      ).toBe(0);
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
});
