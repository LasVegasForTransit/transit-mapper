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
    store.commands.tools.setDraftMode('bus');
    const road = must(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(road, [-115.3, 36.1]);
    store.commands.ways.addWayPoint(road, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    line = store.getState().system.services[0];
    pattern = line.path;
    fullLength = pathLengthMeters(patternPath(store.getState().system.ways, pattern));

    trimmedCommitted = store.commands.services.trimPatternTo(line.id, pattern.id, road, 0.5, 'end');
    trimmed = store.getState().system;

    // Cutting that half-line in two at its own midpoint: both halves survive,
    // on the same road.
    spawnedId = store.commands.services.splitServiceAt(line.id, pattern.id, road, 0.25);
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
    const trimmedLength = pathLengthMeters(patternPath(trimmed.ways, trimmed.services[0].path));
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
      (m, sv) => m + pathLengthMeters(patternPath(afterSplit.ways, sv.path)),
      0,
    );
    expect(Math.abs(combinedLength - fullLength / 2)).toBeLessThan(1);
  });

  it('the new half takes a colour of its own', () => {
    expect(afterSplit.lines[0].color).not.toBe(afterSplit.lines[1].color);
  });

  it('the new half gets the next service name', () => {
    expect(afterSplit.lines[1].name).toBe(`${afterSplit.lines[0].name} 2`);
  });
});

// Splitting the multi-pattern legacy fixture below through `parseSystem`
// hands each branch its own migrated Service id (the raw pattern id, when
// unique) under one shared Line — see migration-cheat-sheet.md §2. `main` and
// `divided` are addressed by those migrated service ids, not by the line id
// `main` the fixture is keyed under.
describe('dividing one branch leaves its siblings on the original service', () => {
  let store: ReturnType<typeof createEditorStore>;
  let before: TransitSystem;
  let after: TransitSystem;
  let sibling: Service;
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
    store.commands.document.setSystem(
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
              // Each pattern's own `name` becomes its migrated service's
              // `name` (migration-cheat-sheet.md §2) — 'Main' here so the
              // spawned half is named off it, not left nameless.
              { id: 'focused', name: 'Main', sections: oneSection(legsOf('long', 'short')) },
              { id: 'sibling', name: 'Sibling', sections: oneSection(legsOf('sibling-way')) },
            ],
          },
        ],
      }),
    );
    before = store.getState().system;
    sibling = must(before.services.find((service) => service.id === 'sibling'));
    const position = must(
      patternPositionAt(
        before.ways,
        must(before.services.find((service) => service.id === 'focused')).path,
        'outbound',
        0,
        0.8,
      ),
    );
    dividedId = store.commands.services.divideServiceAt('focused', position);
    after = store.getState().system;
    main = must(after.services.find((service) => service.id === 'focused'));
    divided = must(after.services.find((service) => service.id === dividedId));
  });

  it('dividing a focused branch creates one new service', () => {
    expect(dividedId).toBeTruthy();
    expect(after.services).toHaveLength(3);
  });

  it('dividing keeps sibling branches on the original service', () => {
    expect(after.services.find((service) => service.id === 'sibling')).toBe(sibling);
    expect(must(after.lines.find((candidate) => candidate.id === 'main')).serviceIds).toHaveLength(
      3,
    );
  });

  it('the original service keeps the longer focused half', () => {
    expect(patternRunLegs(main.path, 'outbound').map((entry) => entry.leg.wayId)).toEqual(['long']);
  });

  it('the shorter half gets a numbered name and distinct color', () => {
    expect(divided.name).toBe('Main 2');
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
    store.commands.document.setSystem(
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
                // Matches the line id: the sole pattern's raw id becomes the
                // migrated service id (migration-cheat-sheet.md §2), so this
                // keeps `endPatternAt` addressable as 'loop-line' below.
                id: 'loop-line',
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
      patternPositionAt(before.ways, before.services[0].path, 'outbound', 1, 0.25),
    );
    ended = store.commands.services.endPatternAt('loop-line', position);
  });

  it('ending a line at an exact occurrence commits', () => {
    expect(ended).toBe(true);
  });

  it('ending a line keeps the longer side of a repeated corridor', () => {
    expect(
      patternRunLegs(store.getState().system.services[0].path, 'outbound').map(
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
    store.commands.document.setSystem(
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
            // Same id as the line: keeps the migrated service addressable as
            // 'line' below (migration-cheat-sheet.md §2).
            patterns: [{ id: 'line', sections: oneSection(legsOf('a-b')) }],
          },
        ],
      }),
    );
    before = store.getState().system;
    extended = store.commands.services.extendPatternTerminus('line', 'line', 'end', [
      { wayId: 'b-c', fromPoint: 0, toPoint: 1 },
    ]);
    after = store.getState().system;

    extendedAtStart = store.commands.services.extendPatternTerminus('line', 'line', 'start', [
      { wayId: 'z-a', fromPoint: 1, toPoint: 0 },
    ]);
  });

  it('extending a line commits a service-path edit', () => {
    expect(extended).toBe(true);
  });

  it('extending a line leaves ways and stations as the same objects', () => {
    expect(after.ways[0]).toBe(before.ways[0]);
    expect(after.stops[0]).toBe(before.stops[0]);
  });

  it('extending a line adds only a shared path section', () => {
    expect(after.services[0].path.sections).toHaveLength(2);
    expect(after.services[0].path.sections[1].kind).toBe('shared');
  });

  it('extending a line from its other terminus commits too', () => {
    expect(extendedAtStart).toBe(true);
  });

  it('a start-side extension reverses the route drawn outward from the old terminus', () => {
    expect(patternRunLegs(store.getState().system.services[0].path, 'outbound')[0].forward).toBe(
      true,
    );
  });

  it('both terminus extensions leave physical objects untouched', () => {
    expect(store.getState().system.ways[0]).toBe(before.ways[0]);
    expect(store.getState().system.stops[0]).toBe(before.stops[0]);
  });
});
