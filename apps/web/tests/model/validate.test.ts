import { beforeEach, describe, expect, it } from 'vitest';
import { validateSystem } from '@transitmapper/core/model/validate';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { estimateWayCapitalCost, formatUsdCompact } from '@transitmapper/core/model/cost';
import { systemBounds, wayLengthMeters } from '@transitmapper/core/model/geo';
import { MODES } from '@transitmapper/core/model/catalog';
import { createEditorStore } from '../../src/editor/store';
import { legendEntriesFor } from '../../src/share/exportLegend';
import { aRoad, aSystem } from '@transitmapper/core/testing/fixtures';

function must<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('expected a defined value');
  return value;
}

describe('validateSystem: ghost records + crossing-without-joining', () => {
  it('a clean fresh system has no issues', () => {
    const store = createEditorStore();
    expect(validateSystem(store.getState().system)).toHaveLength(0);
  });

  it('flags a sub-2-point way', () => {
    // A way with fewer than 2 points is a ghost: accepted, invisible.
    // deleteWayPoint now refuses to drop a way below 2 points (see store.ts),
    // same floor straightenWay already enforced, so the only way one exists is
    // a document that arrives already broken — built via importWays, which
    // trusts an incoming way's points as given.
    const store = createEditorStore();
    const ghostWay = 'ghost';
    store.getState().importWays({
      ways: [
        {
          id: ghostWay,
          typeId: 'lightRail',
          points: [[-115.2, 36.1]],
          geometry: 'straight',
          grade: 'atGrade',
          profile: defaultProfileFor('lightRail'),
        },
      ],
      nodes: [],
      namedWays: [],
      medians: [],
      turnRestrictions: [],
    });
    const issues = validateSystem(store.getState().system);
    expect(issues.some((i) => i.id === `ghost-way-${ghostWay}`)).toBe(true);
  });

  it('flags a station anchored to a missing way', () => {
    // An orphaned station: anchor points at a way id that doesn't exist.
    const store = createEditorStore();
    const stId = store.getState().addStation([-115.15, 36.1], { wayId: 'nonexistent', t: 0.5 });
    const issues = validateSystem(store.getState().system);
    expect(issues.some((i) => i.id === `orphan-station-${stId}`)).toBe(true);
  });

  describe('importing two same-type crossing ways', () => {
    // They arrive already joined: importWays now runs the same crossing pass
    // finishWay does (see store.ts), so there's no unjoined same-type
    // crossing left for the detector to find.
    let store: ReturnType<typeof createEditorStore>;
    let issues: ReturnType<typeof validateSystem>;

    beforeEach(() => {
      store = createEditorStore();
      store.getState().importWays({
        ways: [
          {
            id: 'vx',
            typeId: 'lightRail',
            points: [
              [-115.2, 36.1],
              [-115.1, 36.1],
            ],
            geometry: 'straight',
            grade: 'atGrade',
            profile: defaultProfileFor('lightRail'),
          },
          {
            id: 'vy',
            typeId: 'lightRail',
            points: [
              [-115.15, 36.05],
              [-115.15, 36.15],
            ],
            geometry: 'straight',
            grade: 'atGrade',
            profile: defaultProfileFor('lightRail'),
          },
        ],
        nodes: [],
        namedWays: [],
        medians: [],
        turnRestrictions: [],
      });
      issues = validateSystem(store.getState().system);
    });

    it('importing two same-type crossing ways joins them instead of flagging a crossing', () => {
      expect(issues.some((i) => i.id.startsWith('crossing-'))).toBe(false);
    });

    it('importing crossing ways forms a real junction node', () => {
      expect(store.getState().system.nodes).toHaveLength(1);
    });
  });

  describe('importing a guideway crossing a non-major road', () => {
    // A guideway crossing a (non-major) road at the same grade now forms a
    // real level crossing — see formCrossingJunctions' guideway/road branch —
    // so importing one joins it the same way a same-type crossing does,
    // instead of leaving it flagged with nothing anyone can act on.
    let store: ReturnType<typeof createEditorStore>;
    let issues: ReturnType<typeof validateSystem>;

    beforeEach(() => {
      store = createEditorStore();
      store.getState().importWays({
        ways: [
          {
            id: 'vroad',
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
            id: 'vrail',
            typeId: 'lightRail',
            points: [
              [-115.15, 36.05],
              [-115.15, 36.15],
            ],
            geometry: 'straight',
            grade: 'atGrade',
            profile: defaultProfileFor('lightRail'),
          },
        ],
        nodes: [],
        namedWays: [],
        medians: [],
        turnRestrictions: [],
      });
      issues = validateSystem(store.getState().system);
    });

    it('importing a guideway crossing a non-major road joins it instead of flagging a crossing', () => {
      expect(issues.some((i) => i.id.startsWith('crossing-'))).toBe(false);
    });

    it('importing a guideway-over-road crossing forms a real level-crossing node', () => {
      expect(store.getState().system.nodes).toHaveLength(1);
      expect(store.getState().system.nodes[0].control).toBe('levelCrossing');
    });
  });

  it('parallel, non-crossing ways raise no crossing issue', () => {
    const wP = aRoad(
      'wP',
      [
        [-115.2, 36.1],
        [-115.1, 36.1],
      ],
      { typeId: 'lightRail', profile: defaultProfileFor('lightRail') },
    );
    const wQ = aRoad(
      'wQ',
      [
        [-115.2, 36.11],
        [-115.1, 36.11],
      ],
      { typeId: 'lightRail', profile: defaultProfileFor('lightRail') },
    );
    const system = aSystem({ ways: [wP, wQ] });
    expect(validateSystem(system).some((i) => i.id.startsWith('crossing-'))).toBe(false);
  });
});

describe('Capital cost-per-mile: a labeled range, not a fake-precise figure', () => {
  it('formatUsdCompact renders billions', () => {
    expect(formatUsdCompact(1_250_000_000)).toBe('$1.3B');
  });

  it('formatUsdCompact renders millions', () => {
    expect(formatUsdCompact(45_000_000)).toBe('$45M');
  });

  it('formatUsdCompact renders sub-10M millions with one decimal', () => {
    expect(formatUsdCompact(4_500_000)).toBe('$4.5M');
  });

  it('formatUsdCompact renders thousands', () => {
    expect(formatUsdCompact(2_500)).toBe('$3K');
  });

  describe('an underground heavy rail way', () => {
    let heavyCost: ReturnType<typeof estimateWayCapitalCost>;
    let wayLengthMi: number;

    beforeEach(() => {
      const store = createEditorStore();
      const heavy = store.getState().beginWay('heavyRail', 'straight');
      store.getState().addWayPoint(heavy, [-115.2, 36.1]);
      store.getState().addWayPoint(heavy, [-115.1, 36.1]); // ~9.2km ≈ 5.7mi at this latitude
      store.getState().finishWay();
      store.getState().setWayGrade(heavy, 'underground');
      const heavyWay = must(store.getState().system.ways.find((w) => w.id === heavy));
      heavyCost = estimateWayCapitalCost(heavyWay);
      wayLengthMi = wayLengthMeters(heavyWay) / 1609.344;
    });

    it('underground heavy rail gets a cost estimate', () => {
      expect(heavyCost).not.toBeNull();
    });

    it('cost total scales with length (low < high)', () => {
      const cost = must(heavyCost);
      expect(cost.totalLowUsd).toBeLessThan(cost.totalHighUsd);
    });

    it('total roughly equals per-mile rate × way length', () => {
      const cost = must(heavyCost);
      expect(Math.abs(cost.totalLowUsd - cost.perMileLowUsd * wayLengthMi)).toBeLessThan(1);
    });
  });

  it('a ferry route (no linear right-of-way cost concept) gets no estimate, not a misleading number', () => {
    const store = createEditorStore();
    const ferry = store.getState().beginWay('water', 'straight');
    store.getState().addWayPoint(ferry, [-115.2, 36.1]);
    store.getState().addWayPoint(ferry, [-115.1, 36.1]);
    store.getState().finishWay();
    const ferryWay = must(store.getState().system.ways.find((w) => w.id === ferry));
    expect(estimateWayCapitalCost(ferryWay)).toBeNull();
  });
});

describe('Export: systemBounds + legend entries (the "full-system export" fix)', () => {
  it('systemBounds is null for an empty system', () => {
    const store = createEditorStore();
    expect(systemBounds(store.getState().system)).toBeNull();
  });

  describe('a way, a station footprint, and a facility', () => {
    let store: ReturnType<typeof createEditorStore>;
    let bounds: ReturnType<typeof systemBounds>;
    let facId: string;

    beforeEach(() => {
      store = createEditorStore();
      const wayId = store.getState().beginWay('heavyRail', 'straight');
      store.getState().addWayPoint(wayId, [-115.2, 36.1]);
      store.getState().addWayPoint(wayId, [-115.1, 36.2]);
      store.getState().finishWay();
      const stId = store.getState().addStation([-115.25, 36.05]);
      store.getState().addStationFootprint(stId); // extends the bbox further southwest
      facId = store.getState().addFacility('depot', [-115.05, 36.25]); // extends northeast

      bounds = systemBounds(store.getState().system);
    });

    it('systemBounds returns [sw, ne]', () => {
      expect(bounds).not.toBeNull();
    });

    it("systemBounds' west/south edge is west/south of every point", () => {
      const [[minLng, minLat]] = must(bounds);
      expect(minLng).toBeLessThan(-115.25);
      expect(minLat).toBeLessThan(36.05);
    });

    it("systemBounds' east/north edge is east/north of every point", () => {
      const [, [maxLng, maxLat]] = must(bounds);
      expect(maxLng).toBeGreaterThanOrEqual(-115.05);
      expect(maxLat).toBeGreaterThanOrEqual(36.25);
    });

    describe('after removing the facility', () => {
      beforeEach(() => {
        store.getState().deleteFacility(facId);
      });

      it('legendEntriesFor lists one entry per visible service', () => {
        const view = {
          viewMode: 'network' as const,
          visibleModes: new Set(Object.keys(MODES)),
          visibleWayTypes: new Set(['heavyRail']),
        };
        const expectedName = store.getState().system.services[0]?.name;
        const legend = legendEntriesFor(store.getState().system, view);
        expect(legend).toHaveLength(1);
        expect(legend[0].label).toBe(expectedName);
      });

      it('legendEntriesFor respects the mode filter', () => {
        const view = {
          viewMode: 'network' as const,
          visibleModes: new Set<string>(),
          visibleWayTypes: new Set(['heavyRail']),
        };
        expect(legendEntriesFor(store.getState().system, view)).toHaveLength(0);
      });
    });
  });
});
