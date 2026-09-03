import { describe, expect, it } from 'vitest';
import { parseSystem } from '@transitmapper/core/model/serialize';
import {
  defaultProfileFor,
  laneCapacity,
  MAX_PRIMARY_LANES,
  wayCapacity,
  withLaneCount,
} from '@transitmapper/core/model/profile';
import {
  MAX_GRID_CELLS,
  MAX_OVERSIZE_SEGMENTS,
  segmentGridStats,
  servedWayIds,
} from '@transitmapper/core/model/geo';

// Every check below round-trips a document the store itself produced, which is
// exactly why two denial-of-service bugs lived here undetected: a `capacity` of
// `1e999` (which `JSON.parse` turns into `Infinity`) drove an unbounded lane
// loop, and an out-of-range coordinate made the segment grids iterate ~10^8
// cells. Both hung the tab on first render — including the public embed, so a
// stranger's shared link could take down the reader's page.
//
// These documents are the shapes an attacker or a corrupted file produces, not
// the shapes the editor produces. If one of these ever hangs the suite rather
// than failing it, that is the bug reappearing.
describe('parseSystem survives values a person never types by hand', () => {
  const base = {
    version: 5,
    id: 'h',
    name: 'h',
    viewport: { center: [-115, 36] as [number, number], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    services: [],
    stations: [],
    facilities: [],
    groups: [],
  };
  // Mirrors serialize.ts's wrapLng, so the expectation is derived rather than
  // copied from whatever the implementation happened to print.
  const wrapExpected = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;
  /** `JSON.parse('{"v":1e999}').v` is how `Infinity`/`NaN` actually arrive
   *  from a file — they aren't valid JSON literals a person can type, only a
   *  value `JSON.parse` produces from an in-range literal that overflows. */
  const jsonNumber = (json: string): number => (JSON.parse(json) as { v: number }).v;
  const wayWith = (extra: Record<string, unknown>) => ({
    ...base,
    ways: [
      {
        id: 'w',
        typeId: 'road',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        ...extra,
      },
    ],
  });

  describe('capacity: the value that was Infinity by the time it reached the loop', () => {
    for (const [label, capacity] of [
      ['infinite', jsonNumber('{"v":1e999}')],
      ['negative infinite', jsonNumber('{"v":-1e999}')],
      ['a billion', 1e9],
      ['not a number', jsonNumber('{"v":null}')],
    ] as const) {
      it(`a ${label} capacity parses without hanging`, () => {
        const parsed = parseSystem(wayWith({ capacity, classId: 'arterial' }));
        expect(parsed.ways.length).toBe(1);
      });
      it(`a ${label} capacity is clamped to at most MAX_PRIMARY_LANES`, () => {
        const parsed = parseSystem(wayWith({ capacity, classId: 'arterial' }));
        expect(wayCapacity(parsed.ways[0])).toBeLessThanOrEqual(MAX_PRIMARY_LANES);
      });
      it(`a ${label} capacity still yields at least one lane`, () => {
        const parsed = parseSystem(wayWith({ capacity, classId: 'arterial' }));
        expect(wayCapacity(parsed.ways[0])).toBeGreaterThanOrEqual(1);
      });
    }

    it('a capacity at the ceiling is kept exactly', () => {
      expect(wayCapacity(parseSystem(wayWith({ capacity: MAX_PRIMARY_LANES })).ways[0])).toBe(
        MAX_PRIMARY_LANES,
      );
    });
    it('an ordinary capacity is untouched by the clamp', () => {
      expect(wayCapacity(parseSystem(wayWith({ capacity: 4 })).ways[0])).toBe(4);
    });
  });

  describe('withLaneCount is the same loop reached from the keyboard rather than a file', () => {
    it('withLaneCount refuses to build more than MAX_PRIMARY_LANES', () => {
      expect(
        laneCapacity(withLaneCount(defaultProfileFor('road', 2), 'road', 1e9)),
      ).toBeLessThanOrEqual(MAX_PRIMARY_LANES);
    });
    it('withLaneCount survives an infinite count', () => {
      expect(
        laneCapacity(
          withLaneCount(defaultProfileFor('road', 2), 'road', jsonNumber('{"v":1e999}')),
        ),
      ).toBeLessThanOrEqual(MAX_PRIMARY_LANES);
    });
  });

  // Coordinates. Longitude wraps rather than being dropped: MapLibre hands
  // back unwrapped values when the user pans into an adjacent world copy, and
  // dropping an interior point silently changes the shape of a way.
  describe('an out-of-range coordinate is wrapped or dropped, never left to corrupt the way', () => {
    for (const [label, lng, expected] of [
      ['just past the antimeridian', 181, -179],
      ['far past the antimeridian', 1e6, wrapExpected(1e6)],
      ['exactly at the antimeridian', 180, -180],
    ] as const) {
      it(`a longitude ${label} is kept, not dropped`, () => {
        const parsed = parseSystem(
          wayWith({
            points: [
              [lng, 36.1],
              [-115.1, 36.1],
            ],
          }),
        );
        expect(parsed.ways[0].points.length).toBe(2);
      });
      it(`a longitude ${label} is wrapped onto the globe`, () => {
        const parsed = parseSystem(
          wayWith({
            points: [
              [lng, 36.1],
              [-115.1, 36.1],
            ],
          }),
        );
        expect(Math.abs(parsed.ways[0].points[0][0] - expected)).toBeLessThan(1e-9);
      });
    }

    // Latitude has no wrap-around meaning, so past a pole really is nonsense.
    // The way is left with one point, which draws nothing, so the loader's own
    // repair pass then drops the way as well (see model/junctions.ts's
    // neighbours in serialize.ts).
    it('a latitude past the pole is dropped, and takes the undrawable way with it', () => {
      const parsed = parseSystem(
        wayWith({
          points: [
            [-115.2, 91],
            [-115.1, 36.1],
          ],
        }),
      );
      expect(parsed.ways.length).toBe(0);
    });
    it('an ordinary coordinate is untouched', () => {
      const parsed = parseSystem(
        wayWith({
          points: [
            [-115.2, 36.1],
            [-115.1, 36.1],
          ],
        }),
      );
      expect(parsed.ways[0].points.length).toBe(2);
    });
  });

  // The actual denial-of-service guard. Indexing cost is the area of a
  // segment's bounding box in grid cells, which is driven by how far apart
  // its endpoints are and NOT by how much data there is — so range-checking
  // coordinates does not bound it. Before MAX_SEGMENT_CELLS, a ±5° way froze
  // for 4.2s and ±10° crashed on V8's Map size limit; the world-spanning case
  // asks for ~7.2 billion cells.
  //
  // Asserted on the size of the index rather than on how long building it
  // took. The symptom was elapsed time, but a stopwatch here measures the
  // machine too — this assertion in its original form swung between 366ms and
  // 3972ms across consecutive runs on identical code, purely from load, and
  // failed the suite at random. The cell counts are what actually went wrong,
  // and they are the same on every machine on every run.
  describe('a single oversize segment is held aside rather than expanded', () => {
    for (const [label, lng, lat] of [
      ['spanning five degrees', 5, 2.5],
      ['spanning ten degrees', 10, 5],
      // Built as a Way directly rather than through parseSystem: the parser
      // wraps 180 to -180, which collapses the longitude span to nothing and
      // makes this case pass whether or not the bound exists.
      ['spanning the whole world', 180, 90],
    ] as const) {
      const wideWay = () =>
        label.includes('whole world')
          ? [
              {
                ...parseSystem(
                  wayWith({
                    points: [
                      [-1, -1],
                      [1, 1],
                    ],
                  }),
                ).ways[0],
                points: [
                  [-lng, -lat],
                  [lng, lat],
                ] as [number, number][],
              },
            ]
          : parseSystem(
              wayWith({
                points: [
                  [-lng, -lat],
                  [lng, lat],
                ],
              }),
            ).ways;

      it(`a way ${label} indexes without throwing`, () => {
        const wide = wideWay();
        expect(() => servedWayIds([0, 0], wide, 100)).not.toThrow();
      });
      // Held aside, not expanded: one segment in, nothing in the grid. Without
      // MAX_SEGMENT_CELLS these are the millions-of-cells expansions that froze.
      it(`a way ${label} is held aside rather than expanded`, () => {
        const stats = segmentGridStats(wideWay());
        expect(stats.oversize).toBe(1);
      });
      it(`a way ${label} costs the grid nothing`, () => {
        const stats = segmentGridStats(wideWay());
        expect(stats.entries).toBe(0);
      });
    }
  });

  // One wide segment is not the attack — many are. Capping a single
  // segment's expansion leaves N segments each just under the cap, which
  // multiply out to exactly the blowup the cap was added to stop. Measured
  // without the aggregate bound: 0.10 MB of such segments took 4.5 seconds
  // and 690 MB. This is the check that distinguishes the two bounds.
  // Each case here parses a 10,001-point way and queries its segment grid,
  // which costs ~180ms unloaded against Vitest's 5s default. That is real work
  // rather than a hang: the 10,000 segments are what push past the aggregate
  // bound, so the input cannot shrink without the cases ceasing to test it.
  // Under a machine running several package suites at once the margin is not
  // enough, and the budget is stated here rather than inherited so a busy
  // machine cannot fail the build. It sits on the block because all three
  // cases do the same work — only one of them happened to fail first.
  describe(
    'many individually-legal wide segments are still bounded in aggregate',
    { timeout: 30_000 },
    () => {
      const manyWays = () => {
        const pts: [number, number][] = [];
        for (let i = 0; i < 10_001; i++) pts.push(i % 2 === 0 ? [0, 0] : [0.189, 0.189]);
        return parseSystem({
          ...base,
          ways: [{ id: 'w', typeId: 'road', points: pts, geometry: 'straight', grade: 'atGrade' }],
        }).ways;
      };

      // Each of the 10,000 segments is under MAX_SEGMENT_CELLS on its own, so
      // the per-segment cap lets every one of them through: this is ~41 million
      // entries with only that cap in place, and it is the aggregate bound and
      // nothing else that holds the number below.
      it('ten thousand individually-legal wide segments stay under the grid bound', () => {
        const many = manyWays();
        servedWayIds([0, 0], many, 90);
        const stats = segmentGridStats(many);
        expect(stats.entries).toBeLessThanOrEqual(MAX_GRID_CELLS);
      });
      // Overflow goes to the held-aside list, which every query scans in full —
      // so that list needs its own ceiling or the quadratic comes back there.
      it('the overflow from those segments stays bounded', () => {
        const many = manyWays();
        servedWayIds([0, 0], many, 90);
        const stats = segmentGridStats(many);
        expect(stats.oversize).toBeLessThanOrEqual(MAX_OVERSIZE_SEGMENTS);
      });
      // The bound must not have been reached by silently indexing nothing.
      it('those segments are still indexed', () => {
        const many = manyWays();
        servedWayIds([0, 0], many, 90);
        const stats = segmentGridStats(many);
        expect(stats.entries).toBeGreaterThan(0);
        expect(servedWayIds([0, 0], many, 90)).toContain('w');
      });
    },
  );

  // Held-aside segments must still be found, or the bound would be a silent
  // correctness regression rather than a fix.
  describe('an oversize way is still queryable', () => {
    const wide = () =>
      parseSystem(
        wayWith({
          points: [
            [-50, 0],
            [50, 0],
          ],
        }),
      );

    it('an oversize way is still reported as serving a point on it', () => {
      expect(servedWayIds([0, 0], wide().ways, 100)).toContain('w');
    });
    it('an oversize way is not reported for a point far off it', () => {
      expect(servedWayIds([0, 45], wide().ways, 100).length).toBe(0);
    });
  });

  // Prototype keys in id-shaped positions: `X[id] ?? fallback` does not guard
  // against inherited members, so these used to resolve to Object.prototype's.
  describe('prototype keys in id-shaped positions do not resolve to Object.prototype', () => {
    for (const typeId of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      it(`a way typed "${typeId}" parses to a real way`, () => {
        const parsed = parseSystem(wayWith({ typeId, capacity: 2 }));
        expect(parsed.ways.length).toBe(1);
      });
      it(`a way typed "${typeId}" gets lanes with real widths`, () => {
        const parsed = parseSystem(wayWith({ typeId, capacity: 2 }));
        expect(
          parsed.ways[0].profile.lanes.every(
            (l) => typeof l.widthM === 'number' && Number.isFinite(l.widthM),
          ),
        ).toBe(true);
      });
    }
  });
});
