import { beforeEach, describe, expect, it } from 'vitest';
import {
  oneSection,
  patternPath,
  patternRunLegs,
  pathLengthMeters,
  wholeLeg,
} from '@transitmapper/core/model/geo';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { patternPositionAt } from '@transitmapper/core/model/serviceEdits';
import type { LngLat, Pattern, Service, TransitSystem } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';

const legsOf = (...wayIds: string[]) => wayIds.map((wayId) => wholeLeg(wayId));

/** A non-null assertion by another name — `!` is banned by lint, this isn't. */
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('expected a value, got null/undefined');
  return value;
}

// The same three edits as the pure-function tests in
// `tests/model/lineEditing.test.ts`, but through the store and against real
// geometry.
describe('the same three edits, through the store and against real geometry', () => {
  let store: ReturnType<typeof createEditorStore>;
  let line: Service;
  let pattern: Pattern;
  let fullLength: number;
  let trimmedCommitted: boolean;
  let trimmed: TransitSystem;
  let spawnedId: string | null;
  let afterSplit: TransitSystem;

  beforeEach(() => {
    store = createEditorStore();
    store.getState().setDraftMode('bus');
    const road = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(road, [-115.3, 36.1]);
    store.getState().addWayPoint(road, [-115.1, 36.1]);
    store.getState().finishWay();
    line = store.getState().system.services[0];
    pattern = line.patterns[0];
    fullLength = pathLengthMeters(patternPath(store.getState().system.ways, pattern));

    trimmedCommitted = store.getState().trimPatternTo(line.id, pattern.id, road, 0.5, 'end');
    trimmed = store.getState().system;

    // Cutting that half-line in two at its own midpoint: both halves survive,
    // on the same road.
    spawnedId = store.getState().splitServiceAt(line.id, pattern.id, road, 0.25);
    afterSplit = store.getState().system;
  });

  it('trimming a line reports a committed service-path edit', () => {
    expect(trimmedCommitted).toBe(true);
  });

  it('trimming a line leaves the road it ran on completely alone', () => {
    expect(trimmed.ways).toHaveLength(1);
    expect(trimmed.ways[0].points).toHaveLength(2);
  });

  it('the trimmed line is half as long as it was', () => {
    const trimmedLength = pathLengthMeters(
      patternPath(trimmed.ways, trimmed.services[0].patterns[0]),
    );
    expect(Math.abs(trimmedLength - fullLength / 2)).toBeLessThan(1);
  });

  it('cutting a line in two produces a second line', () => {
    expect(spawnedId).toBeTruthy();
    expect(afterSplit.services).toHaveLength(2);
  });

  it('both halves ride the same road — cutting a line does not cut the street', () => {
    expect(afterSplit.ways).toHaveLength(1);
  });

  it('the two halves add up to the line that was there before', () => {
    const combinedLength = afterSplit.services.reduce(
      (m, sv) => m + pathLengthMeters(patternPath(afterSplit.ways, sv.patterns[0])),
      0,
    );
    expect(Math.abs(combinedLength - fullLength / 2)).toBeLessThan(1);
  });

  it('the new half takes a colour of its own', () => {
    expect(afterSplit.services[0].color).not.toBe(afterSplit.services[1].color);
  });

  it('the new half gets the next service name', () => {
    expect(afterSplit.services[1].name).toBe(`${line.name} 2`);
  });
});

describe('dividing one branch leaves its siblings on the original service', () => {
  let store: ReturnType<typeof createEditorStore>;
  let before: TransitSystem;
  let after: TransitSystem;
  let sibling: Pattern;
  let dividedId: string | null;
  let main: Service;
  let divided: Service;

  beforeEach(() => {
    store = createEditorStore();
    const P = (lng: number, lat: number): LngLat => [lng, lat];
    const a = P(-115.2, 36.1);
    const b = P(-115.17, 36.1);
    const c = P(-115.16, 36.1);
    const d = P(-115.2, 36.11);
    const e = P(-115.19, 36.11);
    store.getState().setSystem(
      parseSystem({
        version: 3,
        palette: ['#2ea44f'],
        ways: [
          { id: 'long', typeId: 'road', points: [a, b], geometry: 'straight', grade: 'atGrade' },
          { id: 'short', typeId: 'road', points: [b, c], geometry: 'straight', grade: 'atGrade' },
          {
            id: 'sibling-way',
            typeId: 'road',
            points: [d, e],
            geometry: 'straight',
            grade: 'atGrade',
          },
        ],
        stations: [],
        services: [
          {
            id: 'main',
            name: 'Main',
            modeId: 'bus',
            color: '#2ea44f',
            patterns: [
              { id: 'focused', sections: oneSection(legsOf('long', 'short')) },
              { id: 'sibling', sections: oneSection(legsOf('sibling-way')) },
            ],
          },
        ],
      }),
    );
    before = store.getState().system;
    sibling = before.services[0].patterns[1];
    const position = must(
      patternPositionAt(before.ways, before.services[0].patterns[0], 'outbound', 0, 0.8),
    );
    dividedId = store.getState().divideServiceAt('main', position);
    after = store.getState().system;
    main = must(after.services.find((service) => service.id === 'main'));
    divided = must(after.services.find((service) => service.id === dividedId));
  });

  it('dividing a focused branch creates one new service', () => {
    expect(dividedId).toBeTruthy();
    expect(after.services).toHaveLength(2);
  });

  it('dividing keeps sibling branches on the original service', () => {
    expect(main.patterns).toHaveLength(2);
    expect(main.patterns[1]).toBe(sibling);
  });

  it('the original service keeps the longer focused half', () => {
    expect(patternRunLegs(main.patterns[0], 'outbound').map((entry) => entry.leg.wayId)).toEqual([
      'long',
    ]);
  });

  it('the shorter half gets a numbered name and distinct color', () => {
    expect(divided.name).toBe('Main 2');
    expect(divided.color).not.toBe(main.color);
  });

  it('dividing a service does not split any way', () => {
    expect(after.ways.length).toBe(before.ways.length);
  });
});

describe('ending a line at the displayed occurrence keeps its longer side', () => {
  let store: ReturnType<typeof createEditorStore>;
  let ended: boolean;

  beforeEach(() => {
    store = createEditorStore();
    const P = (lng: number, lat: number): LngLat => [lng, lat];
    const a = P(-115.2, 36.1);
    const b = P(-115.19, 36.1);
    const c = P(-115.18, 36.1);
    store.getState().setSystem(
      parseSystem({
        version: 3,
        ways: [
          { id: 'out', typeId: 'road', points: [a, b], geometry: 'straight', grade: 'atGrade' },
          {
            id: 'return',
            typeId: 'road',
            points: [b, c],
            geometry: 'straight',
            grade: 'atGrade',
          },
        ],
        stations: [],
        services: [
          {
            id: 'loop-line',
            name: 'Loop line',
            modeId: 'bus',
            color: '#e4572e',
            patterns: [
              {
                id: 'loop-pattern',
                sections: oneSection([
                  wholeLeg('out'),
                  wholeLeg('return'),
                  wholeLeg('out', 'againstPoints'),
                ]),
              },
            ],
          },
        ],
      }),
    );
    const before = store.getState().system;
    const position = must(
      patternPositionAt(before.ways, before.services[0].patterns[0], 'outbound', 1, 0.25),
    );
    ended = store.getState().endPatternAt('loop-line', position);
  });

  it('ending a line at an exact occurrence commits', () => {
    expect(ended).toBe(true);
  });

  it('ending a line keeps the longer side of a repeated corridor', () => {
    expect(
      patternRunLegs(store.getState().system.services[0].patterns[0], 'outbound').map(
        (entry) => entry.leg.wayId,
      ),
    ).toEqual(['return', 'out']);
  });
});

describe('extending a service path keeps physical infrastructure untouched', () => {
  let store: ReturnType<typeof createEditorStore>;
  let before: TransitSystem;
  let after: TransitSystem;
  let extended: boolean;
  let extendedAtStart: boolean;

  beforeEach(() => {
    store = createEditorStore();
    const P = (lng: number, lat: number): LngLat => [lng, lat];
    const z = P(-115.21, 36.1);
    const a = P(-115.2, 36.1);
    const b = P(-115.19, 36.1);
    const c = P(-115.18, 36.1);
    store.getState().setSystem(
      parseSystem({
        version: 3,
        ways: [
          { id: 'z-a', typeId: 'road', points: [z, a], geometry: 'straight', grade: 'atGrade' },
          { id: 'a-b', typeId: 'road', points: [a, b], geometry: 'straight', grade: 'atGrade' },
          { id: 'b-c', typeId: 'road', points: [b, c], geometry: 'straight', grade: 'atGrade' },
        ],
        stations: [{ id: 'at-b', coord: b, anchors: [{ wayId: 'a-b', t: 1 }] }],
        services: [
          {
            id: 'line',
            name: 'Line',
            modeId: 'bus',
            color: '#e4572e',
            patterns: [{ id: 'focused', sections: oneSection(legsOf('a-b')) }],
          },
        ],
      }),
    );
    before = store.getState().system;
    extended = store
      .getState()
      .extendPatternTerminus('line', 'focused', 'end', [
        { wayId: 'b-c', fromPoint: 0, toPoint: 1 },
      ]);
    after = store.getState().system;

    extendedAtStart = store
      .getState()
      .extendPatternTerminus('line', 'focused', 'start', [
        { wayId: 'z-a', fromPoint: 1, toPoint: 0 },
      ]);
  });

  it('extending a line commits a service-path edit', () => {
    expect(extended).toBe(true);
  });

  it('extending a line leaves ways and stations as the same objects', () => {
    expect(after.ways[0]).toBe(before.ways[0]);
    expect(after.stations[0]).toBe(before.stations[0]);
  });

  it('extending a line adds only a shared path section', () => {
    expect(after.services[0].patterns[0].sections).toHaveLength(2);
    expect(after.services[0].patterns[0].sections[1].kind).toBe('shared');
  });

  it('extending a line from its other terminus commits too', () => {
    expect(extendedAtStart).toBe(true);
  });

  it('a start-side extension reverses the route drawn outward from the old terminus', () => {
    expect(
      patternRunLegs(store.getState().system.services[0].patterns[0], 'outbound')[0].forward,
    ).toBe(true);
  });

  it('both terminus extensions leave physical objects untouched', () => {
    expect(store.getState().system.ways[0]).toBe(before.ways[0]);
    expect(store.getState().system.stations[0]).toBe(before.stations[0]);
  });
});
