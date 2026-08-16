import { describe, expect, it } from 'vitest';
import { forkSystem, parseSystem } from '@transitmapper/core/model/serialize';
import { patternWayIds, primaryAnchor } from '@transitmapper/core/model/geo';
import { aPattern, aRoad, aService, aStop, aSystem } from '@transitmapper/core/testing/fixtures';
import type { LngLat } from '@transitmapper/core/model/system';

describe('forking a system gives it a new id and a distinguishable copy name', () => {
  it('fork has new id + copy name', () => {
    // forkSystem is pure and only cares about id/name — no need for a
    // store-built system, just a well-formed one.
    const sys = aSystem();
    const forked = forkSystem(sys);

    expect(forked.id).not.toBe(sys.id);
    expect(forked.name).toContain('(copy)');
  });
});

describe('parsing a v3 document round-trips its ways, services, and stop anchor unchanged', () => {
  // parseSystem is pure and these assertions only concern its output shape,
  // so the input document is built directly via the fixture builders —
  // one way carrying two services, plus a stop anchored to it — rather
  // than driving beginWay/addServiceToWay through the store.
  const wayId = 'w1';
  const points: LngLat[] = [
    [-115.2, 36.1],
    [-115.1, 36.15],
  ];
  const way = aRoad(wayId, points, { typeId: 'lightRail', geometry: 'curved' });
  const before = aSystem({
    ways: [way],
    services: [
      aService('sv1', [aPattern('p1', [way], [wayId])]),
      aService('sv2', [aPattern('p2', [way], [wayId])]),
    ],
    stops: [aStop('st1', [-115.15, 36.12], { wayId, t: 0.4 })],
  });
  const round = parseSystem(JSON.parse(JSON.stringify(before)));

  it('parse round-trips ways', () => {
    expect(round.ways.length).toBe(before.ways.length);
  });

  it('parse round-trips services', () => {
    expect(round.services.length).toBe(2);
  });

  it('parse round-trips stop anchor (wayId)', () => {
    expect(primaryAnchor(round.stops[0])?.wayId).toBe(wayId);
  });
});

describe("a v2 document's corridors get typed from their service's mode, and its roads become road ways", () => {
  // Pure parseSystem input — no store needed.
  const v2 = {
    version: 2,
    id: 'old2',
    name: 'V2 system',
    viewport: { center: [-115.17, 36.13], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    stops: [],
    corridors: [
      {
        id: 'c-subway',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
      },
      {
        id: 'c-tram',
        points: [
          [-115.2, 36.2],
          [-115.1, 36.2],
        ],
        geometry: 'straight',
        grade: 'atGrade',
      },
      {
        id: 'c-mono',
        points: [
          [-115.2, 36.3],
          [-115.1, 36.3],
        ],
        geometry: 'straight',
        grade: 'elevated',
      },
    ],
    services: [
      { id: 'sv1', name: 'Red', mode: 'subway', color: '#c0392b', corridorIds: ['c-subway'] },
      { id: 'sv2', name: 'Green', mode: 'tram', color: '#16a085', corridorIds: ['c-tram'] },
      { id: 'sv3', name: 'Mono', mode: 'monorail', color: '#8b5cf6', corridorIds: ['c-mono'] },
    ],
    roads: [
      {
        id: 'r1',
        coords: [
          [-115.3, 36.1],
          [-115.25, 36.1],
        ],
        class: 'collector',
      },
    ],
  };
  const migrated = parseSystem(v2);
  const typeOf = (id: string) => migrated.ways.find((w) => w.id === id)?.typeId;

  it('v2 subway corridor migrates to heavyRail', () => {
    expect(typeOf('c-subway')).toBe('heavyRail');
  });

  it('v2 tram corridor migrates to lightRail', () => {
    expect(typeOf('c-tram')).toBe('lightRail');
  });

  it('v2 monorail corridor migrates to monorail', () => {
    expect(typeOf('c-mono')).toBe('monorail');
  });

  it('v2 road migrates to a road way with its class preserved', () => {
    expect(typeOf('r1')).toBe('road');
    expect(migrated.ways.find((w) => w.id === 'r1')?.classId).toBe('collector');
  });

  it('migrated services carry modeId (not mode)', () => {
    expect(migrated.services.every((s) => typeof s.modeId === 'string')).toBe(true);
  });
});

describe("a legacy v1 document's lines become a typed way with its own service", () => {
  // Pure parseSystem input — no store needed.
  const legacy = {
    version: 1,
    id: 'old',
    name: 'Legacy',
    viewport: { center: [-115.17, 36.13], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    stops: [{ id: 's1', coord: [-115.15, 36.12], anchor: { lineId: 'l1', t: 0.5 } }],
    lines: [
      {
        id: 'l1',
        name: 'Old Line',
        mode: 'lightRail',
        color: '#e4572e',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.15],
        ],
        geometry: 'curved',
      },
    ],
    roads: [],
  };
  const m = parseSystem(legacy);

  it('legacy line → one way', () => {
    expect(m.ways.length).toBe(1);
    expect(m.ways[0].id).toBe('l1');
  });

  it('legacy lightRail line → lightRail way type', () => {
    expect(m.ways[0].typeId).toBe('lightRail');
  });

  it('legacy line → one service on that way', () => {
    expect(m.services.length).toBe(1);
    expect(patternWayIds(m.services[0].path)[0]).toBe('l1');
  });

  // color/name moved from Service to the containing Line in the restructure.
  it('legacy service keeps color/name', () => {
    expect(m.lines[0].color).toBe('#e4572e');
    expect(m.lines[0].name).toBe('Old Line');
  });

  it('legacy stop anchor migrated lineId → wayId', () => {
    expect(primaryAnchor(m.stops[0])?.wayId).toBe('l1');
  });
});
