import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import { anchorOnWay, routeBetween } from '@transitmapper/core/model/routeGraph';
import {
  candidateWayIdsAlong,
  legRange,
  offsetMeters,
  patternLegs,
  resolveWayPath,
} from '@transitmapper/core/model/geo';
import { MODES } from '@transitmapper/core/model/catalog';
import { validateSystem } from '@transitmapper/core/model/validate';
import { buildFeatures } from '@transitmapper/core/render/buildFeatures';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import type { LngLat, PatternLeg, TransitSystem, Way } from '@transitmapper/core/model/system';

/** A leg's covered stretch, for assertions that used to read fromT/toT. */
const legFrom = (l: PatternLeg): number => legRange(l)[0];
const legTo = (l: PatternLeg): number => legRange(l)[1];

function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

/**
 * Draws the two roads shared by the cross-street auto-naming scenarios below:
 * an east-west 'Home St' and a north-south 'Cross Ave' crossing it at
 * [-115.15, 36.1]. Callers differ only in whether they need to force the
 * crossing junction explicitly, so this returns both way ids and leaves that
 * decision to them.
 */
const drawHomeStAndCrossAve = (
  store: ReturnType<typeof createEditorStore>,
): { ewId: string; nsId: string } => {
  store.commands.tools.setDraftServiceEnabled(false);
  const ewId = mustFind(store.commands.ways.beginWay('road', 'straight'), 'east-west way id');
  store.commands.ways.addWayPoint(ewId, [-115.2, 36.1]);
  store.commands.ways.addWayPoint(ewId, [-115.1, 36.1]);
  store.commands.ways.finishWay();
  store.commands.ways.nameWay(ewId, 'Home St');
  const nsId = mustFind(store.commands.ways.beginWay('road', 'straight'), 'north-south way id');
  store.commands.ways.addWayPoint(nsId, [-115.15, 36.05]);
  store.commands.ways.addWayPoint(nsId, [-115.15, 36.15]);
  store.commands.ways.finishWay();
  store.commands.ways.nameWay(nsId, 'Cross Ave');
  return { ewId, nsId };
};

describe('cross-street auto-naming: pre-filled on placement, never touched again', () => {
  let store: ReturnType<typeof createEditorStore>;
  let stationId: string;

  beforeEach(() => {
    store = createEditorStore();
    // Infrastructure only, no service — that's the fact this section (and
    // the naming choice below) depends on.
    const { nsId } = drawHomeStAndCrossAve(store);
    store.commands.network.formCrossingJunctions(nsId);

    const ewAfterSplit = mustFind(
      store
        .getState()
        .system.ways.find((w) => w.points.some((p) => p[0] === -115.15 && p[1] === 36.1)),
      'east-west way after split',
    );
    // No service rides either road yet, so the unserved/road-anchored default
    // applies — 'alongStreet' style ('@'), not the rail-style '&'; see the
    // dedicated crossStreetNaming.test.ts suite for that rule on its own.
    stationId = mustFind(
      store.commands.stops.addStop([-115.15, 36.1], { wayId: ewAfterSplit.id, t: 1 }),
      'stop id',
    );
  });

  it('placing a station on a named way pre-fills its name from the nearest cross street', () => {
    const placed = mustFind(
      store.getState().system.stops.find((s) => s.id === stationId),
      'placed stop',
    );
    expect(placed.name).toBe('Home St @ Cross Ave');
  });

  it("moving a station leaves its auto-filled name untouched, even though it's no longer accurate", () => {
    store.commands.stops.moveStop(stationId, [-115.12, 36.1]);
    const moved = mustFind(
      store.getState().system.stops.find((s) => s.id === stationId),
      'moved stop',
    );
    expect(moved.name).toBe('Home St @ Cross Ave');
  });
});

describe('cross-street auto-naming: resyncs once a later service proves the unserved guess wrong', () => {
  let store: ReturnType<typeof createEditorStore>;
  let stationId: string;
  let ewAfterSplit: Way;

  beforeEach(() => {
    store = createEditorStore();
    // Infrastructure only, no service — this section's first check depends
    // on the station starting out genuinely unserved.
    drawHomeStAndCrossAve(store);
    // finishWay already forms the crossing junction, splitting 'ew' at it.

    ewAfterSplit = mustFind(
      store
        .getState()
        .system.ways.find((w) => w.points.some((p) => p[0] === -115.15 && p[1] === 36.1)),
      'east-west way after split',
    );
    stationId = mustFind(
      store.commands.stops.addStop([-115.15, 36.1], { wayId: ewAfterSplit.id, t: 1 }),
      'stop id',
    );
  });

  it('an unserved road-anchored station is auto-named along-street and marked autoNamed', () => {
    const placed = mustFind(
      store.getState().system.stops.find((s) => s.id === stationId),
      'placed stop',
    );
    expect(placed).toMatchObject({ name: 'Home St @ Cross Ave', autoNamed: true });
  });

  it('the tram line resyncs the still-autoNamed station to intersection style', () => {
    // Draw a tram line over the whole of the station's own way — tram is
    // street-running, so a 'road'-typed way is a legal alignment for it.
    const sys = store.getState().system;
    const homeWay = mustFind(
      sys.ways.find((w) => w.id === ewAfterSplit.id),
      'home way',
    );
    const from = mustFind(anchorOnWay(homeWay, homeWay.points[0]), 'anchor at start of home way');
    const to = mustFind(
      anchorOnWay(homeWay, homeWay.points[homeWay.points.length - 1]),
      'anchor at end of home way',
    );
    const routed = mustFind(
      routeBetween(sys, from, to, { allowedTypeIds: new Set(['road']) }),
      'route between the ends of home way',
    );
    store.commands.routing.createRoutedService(routed.spans, 'tram');

    const resynced = mustFind(
      store.getState().system.stops.find((s) => s.id === stationId),
      'resynced stop',
    );
    expect(resynced).toMatchObject({ name: 'Home St & Cross Ave', autoNamed: true });
  });
});

// wayCrossings compares every segment of one way against every segment of
// another, with no bbox reject, and formCrossingJunctions runs it on every
// finishWay. Unfiltered that is the whole system per commit. The filter has to
// be exact, not merely cheap: a dropped candidate is a junction that silently
// never forms.
describe('the crossing scan only looks at ways that could actually cross', () => {
  // A field of short ways spread over ~1° — far apart in grid terms.
  const grid: Way[] = [];
  for (let i = 0; i < 200; i++) {
    const lng = -115.5 + i * 0.005;
    grid.push({
      id: `far-${i}`,
      typeId: 'road',
      points: [
        [lng, 36.5],
        [lng + 0.001, 36.5],
      ],
      geometry: 'straight',
      grade: 'atGrade',
      profile: { lanes: [] },
    });
  }
  // One way that genuinely crosses exactly one of them.
  const crosser: Way = {
    id: 'crosser',
    typeId: 'road',
    points: [
      [-115.4995, 36.499],
      [-115.4995, 36.501],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: { lanes: [] },
  };
  const all = [...grid, crosser];
  const candidates = candidateWayIdsAlong(resolveWayPath(crosser), all);

  it('the crossing scan keeps the way that is actually crossed', () => {
    expect(candidates.has('far-0')).toBe(true);
  });

  it('the crossing scan discards ways nowhere near it', () => {
    expect(candidates.has('far-100')).toBe(false);
    expect(candidates.size).toBeLessThan(20);
  });

  // A way spanning many cells must still find everything along its whole
  // length, not just near its endpoints — the failure sampling by coordinate
  // would have.
  it('a way spanning many cells still finds what sits in the middle of it', () => {
    const long: Way = {
      id: 'long',
      typeId: 'road',
      points: [
        [-115.5, 36.4999],
        [-114.5, 36.4999],
      ],
      geometry: 'straight',
      grade: 'atGrade',
      profile: { lanes: [] },
    };
    const alongLong = candidateWayIdsAlong(resolveWayPath(long), all);
    expect(alongLong.has('far-100')).toBe(true);
  });
});

// The complaint this feature exists for: two lines running down the same
// street read as two separate streets. Drawing used to adopt an existing
// corridor only when the very first press landed on it; every stroke after
// that laid parallel geometry no matter how exactly it tracked what was
// already there.
describe('a line drawn along an existing one SHARES it', () => {
  let store: ReturnType<typeof createEditorStore>;
  const origin: LngLat = [-115.2, 36.1];
  let first: string;

  beforeEach(() => {
    store = createEditorStore();
    store.commands.tools.setDraftMode('bus');
    first = mustFind(store.commands.ways.beginWay('road', 'straight'), 'first way id');
    store.commands.ways.addWayPoint(first, offsetMeters(origin, 0, 0));
    store.commands.ways.addWayPoint(first, offsetMeters(origin, 600, 0));
    store.commands.ways.finishWay();
  });

  it('the first line lays its own road', () => {
    expect(store.getState().system.ways).toHaveLength(1);
  });

  describe('a second line down the same street, started in empty space a few metres off the first', () => {
    beforeEach(() => {
      // Started off the first — which is what a mouse actually produces.
      const second = mustFind(store.commands.ways.beginWay('road', 'straight'), 'second way id');
      store.commands.ways.addWayPoint(second, offsetMeters(origin, 100, 4));
      store.commands.ways.addWayPoint(second, offsetMeters(origin, 500, 4));
      store.commands.ways.finishWay();
    });

    it('a second line down the same street lays no second road', () => {
      expect(store.getState().system.ways).toHaveLength(1);
    });

    it('both lines exist as lines', () => {
      expect(store.getState().system.services).toHaveLength(2);
    });

    it('the second line rides the road the first one laid', () => {
      const after = store.getState().system;
      expect(
        after.services.every((sv) => patternLegs(sv.path).every((l) => l.wayId === first)),
      ).toBe(true);
    });

    it('it rides only the stretch it was drawn over, not the whole road', () => {
      const after = store.getState().system;
      expect(after.services.some((sv) => patternLegs(sv.path).some((l) => legFrom(l) > 0))).toBe(
        true,
      );
    });

    it('the shared road is drawn once, with both lines fanned across it', () => {
      const after = store.getState().system;
      expect(
        buildFeatures(after, null, [], {
          viewMode: 'network',
          visibleModes: new Set(Object.keys(MODES)),
          visibleWayTypes: new Set(['road']),
          // buildFeatures now requires a resolved `presentation` (the renderer
          // boundary crosses into real screen-space facts). This check only
          // cares about service/lane topology, not camera-dependent LOD.
          presentation: renderPresentationForViewport({
            center: [0, 0],
            zoom: 0,
            width: 1_440,
            height: 900,
          }),
        }).services.features.filter((feature) => !feature.properties?.hitTarget).length,
      ).toBe(2);
    });
  });
});

describe('Alt is the way out: deliberately separate infrastructure', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
    const origin: LngLat = [-115.2, 36.1];
    store.commands.tools.setDraftMode('bus');
    const road = mustFind(store.commands.ways.beginWay('road', 'straight'), 'road way id');
    store.commands.ways.addWayPoint(road, offsetMeters(origin, 0, 0));
    store.commands.ways.addWayPoint(road, offsetMeters(origin, 600, 0));
    store.commands.ways.finishWay();

    store.commands.tools.setDraftSeparate(true);
    const busway = mustFind(store.commands.ways.beginWay('road', 'straight'), 'busway id');
    store.commands.ways.addWayPoint(busway, offsetMeters(origin, 100, 4));
    store.commands.ways.addWayPoint(busway, offsetMeters(origin, 500, 4));
    store.commands.ways.finishWay();
  });

  it('Alt lays a second, independent road beside the first', () => {
    expect(store.getState().system.ways).toHaveLength(2);
  });

  it('and the next line drawn shares again, without having to be told', () => {
    expect(store.getState().draftSeparate).toBe(false);
  });
});

// A bus is somewhere in a carriageway that is itself road-width, so 4m off
// still means the same road. A train is on the track or it isn't, so the same
// 4m offset is a second track.
describe('how close counts as "along" is a fact about the mode', () => {
  const origin: LngLat = [-115.2, 36.1];
  const drawPair = (modeId: string, wayTypeId: string, offsetM: number): number => {
    const store = createEditorStore();
    store.commands.tools.setDraftMode(modeId);
    const a = mustFind(store.commands.ways.beginWay(wayTypeId, 'straight'), 'way a id');
    store.commands.ways.addWayPoint(a, offsetMeters(origin, 0, 0));
    store.commands.ways.addWayPoint(a, offsetMeters(origin, 600, 0));
    store.commands.ways.finishWay();
    const b = mustFind(store.commands.ways.beginWay(wayTypeId, 'straight'), 'way b id');
    store.commands.ways.addWayPoint(b, offsetMeters(origin, 100, offsetM));
    store.commands.ways.addWayPoint(b, offsetMeters(origin, 500, offsetM));
    store.commands.ways.finishWay();
    return store.getState().system.ways.length;
  };

  it('a bus line 4m off an existing road rides that road', () => {
    expect(drawPair('bus', 'road', 4)).toBe(1);
  });

  it('a rail line 10m off an existing track is a SECOND track, not the same one', () => {
    expect(drawPair('subway', 'heavyRail', 10)).toBe(2);
  });

  it('a rail line drawn right on an existing track still shares it', () => {
    expect(drawPair('subway', 'heavyRail', 1)).toBe(1);
  });

  it('every mode declares a tolerance or takes the road-width default', () => {
    expect(
      Object.values(MODES).every(
        (m) => m.corridorToleranceM === undefined || m.corridorToleranceM > 0,
      ),
    ).toBe(true);
  });
});

// Drawing shares by default now, but a map made before that has the same
// corridor two or three times over. This is the explicit repair — never
// automatic, because silently rewriting a saved system is not acceptable.
describe('fusing corridors that were already drawn separately', () => {
  const origin: LngLat = [-115.2, 36.1];
  const twoParallelLines = (
    offsetM: number,
    secondFrom: number,
    secondTo: number,
  ): { store: ReturnType<typeof createEditorStore>; ids: string[] } => {
    const store = createEditorStore();
    store.commands.tools.setDraftMode('bus');
    const ids: string[] = [];
    for (const [from, to, off] of [
      [0, 600, 0],
      [secondFrom, secondTo, offsetM],
    ] as [number, number, number][]) {
      store.commands.tools.setDraftSeparate(true); // as a map drawn before sharing
      const w = mustFind(store.commands.ways.beginWay('road', 'straight'), 'way id');
      store.commands.ways.addWayPoint(w, offsetMeters(origin, from, off));
      store.commands.ways.addWayPoint(w, offsetMeters(origin, to, off));
      store.commands.ways.finishWay();
      ids.push(w);
    }
    return { store, ids };
  };

  // The common case for a map drawn before sharing: the same corridor drawn
  // twice, the second one within the first.
  describe('the common case: the same corridor drawn twice, the second within the first', () => {
    let store: ReturnType<typeof createEditorStore>;
    let doubled: string[];

    beforeEach(() => {
      ({ store, ids: doubled } = twoParallelLines(4, 100, 500));
    });

    it('two lines drawn separately really are two roads', () => {
      expect(store.getState().system.ways).toHaveLength(2);
    });

    describe('merging them into one corridor', () => {
      let absorbed: number;
      let after: TransitSystem;

      beforeEach(() => {
        absorbed = store.commands.network.mergeWaysIntoCorridor(doubled);
        after = store.getState().system;
      });

      it('merging reports what it absorbed', () => {
        expect(absorbed).toBe(1);
      });

      it('the two roads become one', () => {
        expect(after.ways).toHaveLength(1);
      });

      it('both lines survive the merge', () => {
        expect(after.services).toHaveLength(2);
      });

      it('both lines now ride the one remaining road', () => {
        expect(
          after.services.every((sv) =>
            patternLegs(sv.path).every((l) => l.wayId === after.ways[0].id),
          ),
        ).toBe(true);
      });

      it('the shorter line rides only the stretch of it that it covered', () => {
        expect(
          after.services.some((sv) =>
            patternLegs(sv.path).some((l) => legFrom(l) > 0 && legTo(l) < 1),
          ),
        ).toBe(true);
      });
    });
  });

  // A line that runs along the corridor and then carries on past the end of it
  // fuses the shared part and keeps its own geometry for the rest — the stub
  // is the stretch that genuinely is not the same road.
  describe('a line that runs along the corridor and carries on past the end of it', () => {
    let store: ReturnType<typeof createEditorStore>;
    let overhanging: string[];

    beforeEach(() => {
      ({ store, ids: overhanging } = twoParallelLines(4, 300, 900));
    });

    it('an overhanging line still counts as absorbed', () => {
      expect(store.commands.network.mergeWaysIntoCorridor(overhanging)).toBe(1);
    });

    describe('after merging', () => {
      let partial: TransitSystem;

      beforeEach(() => {
        store.commands.network.mergeWaysIntoCorridor(overhanging);
        partial = store.getState().system;
      });

      it('the corridor it ran along is kept, and only its overhang stays separate', () => {
        expect(partial.ways).toHaveLength(2);
        expect(partial.ways.map((w) => w.id)).toContain(overhanging[0]);
      });

      it('the overhanging line rides both the shared corridor and its own tail', () => {
        expect(
          partial.services.some(
            (sv) =>
              patternLegs(sv.path).length === 2 &&
              patternLegs(sv.path).some((l) => l.wayId === overhanging[0]),
          ),
        ).toBe(true);
      });

      it('the fused line has no route with a gap in it', () => {
        expect(validateSystem(partial).every((i) => !i.id.startsWith('broken-pattern'))).toBe(true);
      });

      it('a two-click line does not come back with a pile of extra drag handles', () => {
        expect(partial.ways.every((w) => w.points.length <= 3)).toBe(true);
      });
    });
  });

  // Far apart is not one corridor, and saying so is better than fusing things
  // that aren't the same street.
  describe('ways that are nowhere near each other', () => {
    let store: ReturnType<typeof createEditorStore>;
    let apart: string[];

    beforeEach(() => {
      ({ store, ids: apart } = twoParallelLines(300, 100, 500));
    });

    it('ways that are nowhere near each other are left alone', () => {
      const merged = store.commands.network.mergeWaysIntoCorridor(apart);
      expect(merged).toBe(0);
      expect(store.getState().system.ways).toHaveLength(2);
    });

    it('merging needs at least two ways', () => {
      expect(store.commands.network.mergeWaysIntoCorridor([apart[0]])).toBe(0);
    });
  });
});
