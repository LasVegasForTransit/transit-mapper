import { beforeEach, describe, expect, it } from 'vitest';
import { patternPositionAt } from '@transitmapper/core/model/serviceEdits';
import { validateSystemQuick } from '@transitmapper/core/model/validate';
import { patternLegs, serviceWayIds } from '@transitmapper/core/model/geo';
import type { LngLat } from '@transitmapper/core/model/system';
import type { SelectionAction } from '@transitmapper/core/model/selectionActions';
import { createEditorStore, type MultiSelectItem } from '../../src/editor/store';
import { createSelectionActions } from '../../src/editor/actions';

type Store = ReturnType<typeof createEditorStore>;

function must<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('expected a defined value');
  return value;
}

describe('cutting where you CLICKED: point-anchored actions that make a stretch of a line removable without a station at each end', () => {
  describe('a line drawn on one straight way', () => {
    let store: Store, line: string, registry: ReturnType<typeof createSelectionActions>;
    let refs: MultiSelectItem[];
    const midway: LngLat = [-115.15, 36.1];

    beforeEach(() => {
      store = createEditorStore();
      const way = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(way, [-115.2, 36.1]);
      store.getState().addWayPoint(way, [-115.1, 36.1]);
      store.getState().finishWay();
      line = store.getState().system.services[0].id;
      registry = createSelectionActions(store);
      refs = [{ kind: 'service', id: line }];
    });

    const at = (coord: LngLat, t?: number) => {
      const current = store.getState().system;
      const pattern = must(current.services.find((service) => service.id === line)).patterns[0];
      const serviceHit =
        t === undefined
          ? undefined
          : {
              serviceId: line,
              patternId: pattern.id,
              run: 'outbound' as const,
              legIndex: 0,
              position: must(patternPositionAt(current.ways, pattern, 'outbound', 0, t)),
            };
      return registry.actionsFor({ system: current, refs, at: coord, serviceHit });
    };

    it('without a click position a line offers no point-anchored cut', () => {
      expect(
        registry
          .actionsFor({ system: store.getState().system, refs })
          .every((a) => !a.id.startsWith('service.cutHere')),
      ).toBe(true);
    });

    it('clicking along the line offers to cut it there', () => {
      expect(at(midway, 0.5).some((a) => a.id === 'service.cutHere')).toBe(true);
    });

    it('clicking at the very end of a line offers no cut, since there is nothing to cut off', () => {
      expect(at([-115.2, 36.1]).every((a) => a.group !== 'cut')).toBe(true);
    });

    describe('ending the line at the clicked point', () => {
      beforeEach(() => {
        must(at(midway, 0.5).find((a) => a.id === 'service.endHere')).run();
      });

      it('ending the line at the clicked point shortens it there', () => {
        const trimmed = store.getState().system.services[0].patterns[0];
        const section = trimmed.sections[0];
        const legs = section.kind === 'split' ? section.outbound : section.legs;
        const extent = legs[0].extent;
        expect(legs).toHaveLength(1);
        expect(extent.kind).toBe('stretch');
        if (extent.kind === 'stretch') {
          expect(extent.toT < 0.6 || extent.fromT > 0.4).toBe(true);
        }
      });

      it('…and leaves the street it ran on alone', () => {
        expect(store.getState().system.ways).toHaveLength(1);
      });
    });
  });

  it('cutting a line at a point leaves two lines', () => {
    // Cut at a point, and the far half becomes its own line — how a stretch in
    // the middle comes out: cut at both ends, delete the middle.
    const store = createEditorStore();
    const way2 = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(way2, [-115.2, 36.1]);
    store.getState().addWayPoint(way2, [-115.1, 36.1]);
    store.getState().finishWay();
    const line2 = store.getState().system.services[0].id;
    const refs2: MultiSelectItem[] = [{ kind: 'service', id: line2 }];
    const registry = createSelectionActions(store);
    const pattern2 = must(store.getState().system.services.find((service) => service.id === line2))
      .patterns[0];
    const serviceHit = {
      serviceId: line2,
      patternId: pattern2.id,
      run: 'outbound' as const,
      legIndex: 0,
      position: must(patternPositionAt(store.getState().system.ways, pattern2, 'outbound', 0, 0.5)),
    };
    const cut = must(
      registry
        .actionsFor({
          system: store.getState().system,
          refs: refs2,
          at: [-115.15, 36.1],
          serviceHit,
        })
        .find((a) => a.id === 'service.cutHere'),
    );
    cut.run();

    expect(store.getState().system.services).toHaveLength(2);
  });

  describe('a way divides at a click (splitWayAt alone only ever cuts at an existing control point)', () => {
    let store: Store, way3: string, divide: SelectionAction | undefined;

    beforeEach(() => {
      store = createEditorStore();
      way3 = store.getState().beginWay('road', 'straight');
      store.getState().addWayPoint(way3, [-115.2, 36.1]);
      store.getState().addWayPoint(way3, [-115.1, 36.1]);
      store.getState().finishWay();
      const refs3: MultiSelectItem[] = [{ kind: 'way', id: way3 }];
      const registry = createSelectionActions(store);
      divide = registry
        .actionsFor({
          system: store.getState().system,
          refs: refs3,
          at: [-115.15, 36.1],
          corridorHit: { wayId: way3, t: 0.5 },
        })
        .find((a) => a.id === 'way.splitHere');
    });

    it('a way offers to divide where you clicked', () => {
      expect(divide).toBeDefined();
    });

    describe('after dividing', () => {
      beforeEach(() => {
        must(divide).run();
      });

      it('dividing a way at a point leaves two ways', () => {
        expect(store.getState().system.ways).toHaveLength(2);
      });
    });
  });
});

describe('selecting LINES: services join the multi-select group, the action registry offers what the geometry supports, and each action runs', () => {
  let store: Store, lineW: string, lineE: string;

  beforeEach(() => {
    store = createEditorStore();
    // Two lines meeting nose to tail at [-115.15, 36.1].
    const wayW = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(wayW, [-115.2, 36.1]);
    store.getState().addWayPoint(wayW, [-115.15, 36.1]);
    store.getState().finishWay();
    const wayE = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(wayE, [-115.15, 36.1]);
    store.getState().addWayPoint(wayE, [-115.1, 36.1]);
    store.getState().finishWay();
    [lineW, lineE] = store.getState().system.services.map((sv) => sv.id);
  });

  it('a service can be part of a multi-selection', () => {
    store.getState().toggleMultiSelect({ kind: 'service', id: lineW });
    store.getState().toggleMultiSelect({ kind: 'service', id: lineE });
    expect(store.getState().multiSelection).toHaveLength(2);
  });

  it('extending a single selection groups both, not just the second', () => {
    store.getState().select({ kind: 'service', id: lineW });
    store.getState().extendSelection({ kind: 'service', id: lineE });
    expect(store.getState().multiSelection).toHaveLength(2);
  });

  it('…and extending onto the one thing already selected groups it once', () => {
    store.getState().select({ kind: 'service', id: lineW });
    store.getState().extendSelection({ kind: 'service', id: lineW });
    expect(store.getState().multiSelection).toHaveLength(1);
  });

  it('a plain toggle still builds the group from scratch', () => {
    store.getState().select({ kind: 'service', id: lineW });
    store.getState().toggleMultiSelect({ kind: 'service', id: lineE });
    expect(store.getState().multiSelection).toHaveLength(1);
  });

  describe('both lines toggled into the group', () => {
    let registry: ReturnType<typeof createSelectionActions>, refs: MultiSelectItem[];
    let actionIds: string[];

    beforeEach(() => {
      store.getState().toggleMultiSelect({ kind: 'service', id: lineW });
      store.getState().toggleMultiSelect({ kind: 'service', id: lineE });
      registry = createSelectionActions(store);
      refs = store.getState().multiSelection;
      actionIds = registry.actionsFor({ system: store.getState().system, refs }).map((a) => a.id);
    });

    it('two lines that meet end to end are offered a through-route', () => {
      expect(actionIds).toContain('service.throughRoute');
    });

    it('an action that applies to no selection is absent', () => {
      expect(actionIds).not.toContain('way.mergeCorridor');
    });

    describe('only one of the two lines selected (an unambiguous end needs an exact terminus hit)', () => {
      let oneIds: string[];

      beforeEach(() => {
        const oneRef = [{ kind: 'service' as const, id: lineW }];
        oneIds = registry
          .actionsFor({ system: store.getState().system, refs: oneRef })
          .map((a) => a.id);
      });

      it('one selected line is not offered an ambiguous return-path conversion', () => {
        expect(oneIds).not.toContain('service.drawReturnPath');
        expect(oneIds).not.toContain('service.convertTerminus');
      });

      it('a line that is not split is not offered to be un-split', () => {
        expect(oneIds).not.toContain('service.makeTwoWay');
      });

      it('the two-line merges are absent when only one line is selected', () => {
        expect(oneIds).not.toContain('service.throughRoute');
        expect(oneIds).not.toContain('service.mergeInto');
      });
    });

    describe('running the through-route', () => {
      let before: number;

      beforeEach(() => {
        before = store.getState().system.services.length;
        must(
          registry
            .actionsFor({ system: store.getState().system, refs })
            .find((action) => action.id === 'service.throughRoute'),
        ).run();
      });

      it('running the through-route leaves one line', () => {
        expect(store.getState().system.services).toHaveLength(before - 1);
      });

      it('the joined line runs both ways end to end', () => {
        expect(patternLegs(store.getState().system.services[0].patterns[0])).toHaveLength(2);
      });

      it('the joined line has no gap for the validator to report', () => {
        expect(
          validateSystemQuick(store.getState().system).every(
            (i) => !i.id.startsWith('broken-pattern'),
          ),
        ).toBe(true);
      });
    });
  });

  describe('nudging a group that holds a line (a service has no geometry of its own to move)', () => {
    let road: string, line: string, pointsBefore: string;

    beforeEach(() => {
      // A fresh store here, not the outer describe's wayW/wayE fixture,
      // matching the original's fresh() reset at this point.
      store = createEditorStore();
      road = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(road, [-115.2, 36.2]);
      store.getState().addWayPoint(road, [-115.1, 36.2]);
      store.getState().finishWay();
      line = must(
        store.getState().system.services.find((sv) => serviceWayIds(sv).includes(road)),
      ).id;
      store.getState().toggleMultiSelect({ kind: 'service', id: line });
      pointsBefore = JSON.stringify(
        must(store.getState().system.ways.find((w) => w.id === road)).points,
      );
      store.getState().nudgeMultiSelection(0.01, 0.01);
    });

    it('nudging a selected line moves no infrastructure', () => {
      const points = must(store.getState().system.ways.find((w) => w.id === road)).points;
      expect(JSON.stringify(points)).toBe(pointsBefore);
    });

    describe('deleting the group', () => {
      beforeEach(() => {
        store.getState().deleteMultiSelection();
      });

      it('deleting a selected line removes the service', () => {
        expect(store.getState().system.services).toHaveLength(0);
      });

      it('…and leaves the street it rode standing', () => {
        expect(store.getState().system.ways).toHaveLength(1);
      });
    });
  });
});
