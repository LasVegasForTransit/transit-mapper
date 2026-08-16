import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import {
  detectShapeRuns,
  metersFromOrigin,
  offsetMeters,
  pathLengthMeters,
  patternPath,
  patternWayIds,
} from '@transitmapper/core/model/geo';
import type { LngLat, Service, TransitSystem, Way } from '@transitmapper/core/model/system';
import { required } from '../support/required.test';

/** Narrows an optional lookup result without a non-null assertion: every call
 * site here knows from the fixture it just built that the value exists. */
function must<T>(value: T | null | undefined, label = 'value'): T {
  if (value == null) throw new Error(`expected ${label} to be defined`);
  return value;
}

describe('detectShapeRuns matches an imported shape against existing ways corridor by corridor', () => {
  const origin: LngLat = [-115.2, 36.1];
  const mkWay = (id: string, pts: LngLat[]): Way => ({
    id,
    typeId: 'road',
    points: pts,
    geometry: 'straight',
    grade: 'atGrade',
    profile: { lanes: [] },
  });

  // A — parallel-then-diverging (the trunk-and-branch case): a shape that
  // hugs an existing way for 200m then turns away should conflate only the
  // shared stretch, leaving the diverging tail fresh.
  describe('parallel-then-diverging', () => {
    const W = mkWay('W', [offsetMeters(origin, 0, 0), offsetMeters(origin, 400, 0)]);
    const path = [
      offsetMeters(origin, 0, 5),
      offsetMeters(origin, 200, 5),
      offsetMeters(origin, 200, 50),
    ];
    const runs = detectShapeRuns(path, [W]);

    it('the shared stretch and the diverging tail become two separate runs', () => {
      expect(runs.length).toBe(2);
    });

    it('first run is on the existing way', () => {
      expect(runs[0]).toMatchObject({ onWayId: 'W', fromIdx: 0, toIdx: 1 });
    });

    it('second run is fresh (the diverging tail)', () => {
      expect(runs[1]).toMatchObject({ fresh: true, fromIdx: 1, toIdx: 2 });
    });
  });

  // B — brief coincidental crossing: a mostly-unrelated path that happens to
  // run parallel to an existing way for a sub-tolerance 15m jog right where
  // it crosses should NOT conflate — the whole path stays fresh.
  describe('brief coincidental crossing', () => {
    it('collapses to a single fresh run', () => {
      const V = mkWay('V', [offsetMeters(origin, 300, -100), offsetMeters(origin, 300, 300)]);
      const path = [
        offsetMeters(origin, 0, 0), // approaches heading east — 90° off V's heading, rejected regardless of proximity
        offsetMeters(origin, 300, 0), // lands ~on V, but the segment INTO it was heading-rejected
        offsetMeters(origin, 300, 15), // a 15m jog running parallel to V (< MIN_RUN_M) — a coincidental blip
        offsetMeters(origin, 600, 300), // diverges away again — heading-rejected
      ];
      const runs = detectShapeRuns(path, [V]);
      expect(runs.length).toBe(1);
      expect(runs[0]).toMatchObject({ fresh: true, fromIdx: 0, toIdx: 3 });
    });
  });

  // C — multi-way run: existing infrastructure that itself splits mid-corridor
  // (two ways sharing a coincident endpoint) sub-divides the matched run with
  // no special-casing, then a short fresh tail past the end.
  describe('multi-way run', () => {
    const A = mkWay('A', [offsetMeters(origin, 0, 0), offsetMeters(origin, 200, 0)]);
    const B = mkWay('B', [offsetMeters(origin, 200, 0), offsetMeters(origin, 400, 0)]);
    const path = [
      offsetMeters(origin, 0, 3),
      offsetMeters(origin, 200, 3),
      offsetMeters(origin, 400, 3),
      offsetMeters(origin, 400, 40),
    ];
    const runs = detectShapeRuns(path, [A, B]);

    it('the split infrastructure produces three runs, one per way plus the fresh tail', () => {
      expect(runs.length).toBe(3);
    });

    it('the first run lands on way A', () => {
      expect(runs[0]).toMatchObject({ onWayId: 'A' });
    });

    it('the second run lands on way B', () => {
      expect(runs[1]).toMatchObject({ onWayId: 'B' });
    });

    it('third run is the fresh tail', () => {
      expect('fresh' in runs[2]).toBe(true);
    });
  });
});

// reconcileImportedServices is the store-level orchestrator over
// detectShapeRuns: a shorter shuttle conflates onto a longer trunk's
// already-imported way instead of keeping duplicate overlapping geometry.
describe('reconciling imported services conflates a shuttle onto the trunk way it overlaps', () => {
  let store: ReturnType<typeof createEditorStore>;
  const origin: LngLat = [-115.2, 36.1];
  let trunk: string;
  let shuttle: string;
  let trunkSvcId: string;
  let shuttleSvcId: string;

  beforeEach(() => {
    store = createEditorStore();
    store.commands.tools.setDraftMode('bus');

    // Both lines are laid as DELIBERATELY separate infrastructure, which is the
    // state a GTFS import arrives in — importGtfs mints one way per shape and
    // never goes through finishWay, so nothing conflates them on the way in.
    // Drawing them by hand would now share them at commit, which is the whole
    // point of this test: reconcile is what fixes the mess an import leaves.
    store.commands.tools.setDraftSeparate(true);

    // Trunk: a long solo-way pattern, as a freshly-imported GTFS shape would be.
    trunk = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(trunk, offsetMeters(origin, 0, 0));
    store.commands.ways.addWayPoint(trunk, offsetMeters(origin, 400, 0));
    store.commands.ways.finishWay();
    trunkSvcId = must(
      store.getState().system.services.find((sv) => patternWayIds(sv.path).includes(trunk)),
      'trunk service',
    ).id;

    // Shuttle: another solo-way pattern, a strict corridor subset of the trunk
    // (offset 3m, spanning only the middle 200m) — diverges at both ends by
    // simply not covering the trunk's outer stretches, the exact "shares a
    // trunk, doesn't share termini" shape this feature targets.
    store.commands.tools.setDraftSeparate(true);
    shuttle = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(shuttle, offsetMeters(origin, 100, 3));
    store.commands.ways.addWayPoint(shuttle, offsetMeters(origin, 300, 3));
    store.commands.ways.finishWay();
    shuttleSvcId = must(
      store.getState().system.services.find((sv) => patternWayIds(sv.path).includes(shuttle)),
      'shuttle service',
    ).id;
  });

  it('trunk and shuttle each start on their own solo way', () => {
    const before = store.getState().system;
    expect(before.ways.length).toBe(2);
    expect(before.services.length).toBe(2);
  });

  it('exactly one pattern (the shuttle) needed reconciling', () => {
    const reconciled = store.commands.imports.reconcileImportedServices([trunkSvcId, shuttleSvcId]);
    expect(reconciled).toBe(1);
  });

  it('no whole duplicate alignment was created — at most 2 net new ways from splitting the trunk', () => {
    const waysBefore = store.getState().system.ways.length;
    store.commands.imports.reconcileImportedServices([trunkSvcId, shuttleSvcId]);
    expect(store.getState().system.ways.length).toBeLessThanOrEqual(waysBefore + 2);
  });

  describe('after reconciling', () => {
    let after: TransitSystem;
    let trunkAfter: Service;
    let shuttleAfter: Service;

    beforeEach(() => {
      store.commands.imports.reconcileImportedServices([trunkSvcId, shuttleSvcId]);
      after = store.getState().system;
      trunkAfter = must(
        after.services.find((sv) => sv.id === trunkSvcId),
        'trunk service after reconcile',
      );
      shuttleAfter = must(
        after.services.find((sv) => sv.id === shuttleSvcId),
        'shuttle service after reconcile',
      );
    });

    // The trunk's original way gets SPLIT to carve out the shared middle
    // sub-range (splitWay correctly extends every rider's pattern — including
    // the trunk's own — to cover all the resulting pieces, so its route is
    // never silently shortened): assert continuity, not an unchanged wayIds
    // array. The original trunk wayId survives as (at least) the front piece,
    // and the trunk's full route still spans its original ~400m end to end.
    it("the trunk's original way id survives as (part of) its route", () => {
      expect(patternWayIds(trunkAfter.path)).toContain(trunk);
    });

    it("the trunk's route is still continuous end-to-end (splitting didn't drop any of it)", () => {
      const trunkLength = pathLengthMeters(patternPath(after.ways, trunkAfter.path));
      expect(Math.abs(trunkLength - 400)).toBeLessThan(1);
    });

    it('the shuttle no longer rides its own original solo way', () => {
      expect(patternWayIds(shuttleAfter.path)).not.toContain(shuttle);
    });

    it("the shuttle's original solo way was removed, not left as a duplicate", () => {
      expect(after.ways.some((w) => w.id === shuttle)).toBe(false);
    });

    it("the shuttle's new way(s) lie on the trunk's alignment (y≈0), not its own original 3m offset", () => {
      const onTrunkAlignment = (wid: string) => {
        const way = must(
          after.ways.find((w) => w.id === wid),
          'shuttle way',
        );
        return way.points.every((p) => Math.abs(metersFromOrigin(origin, p)[1]) < 1);
      };
      expect(patternWayIds(shuttleAfter.path).every(onTrunkAlignment)).toBe(true);
    });
  });
});
