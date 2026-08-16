import { beforeEach, describe, expect, it } from 'vitest';
import { pointAtT, resolveWayPath } from '@transitmapper/core/model/geo';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';

type Store = ReturnType<typeof createEditorStore>;

function must<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('expected a defined value');
  return value;
}

describe('multi-select: toggle, bulk move (nudge), bulk delete', () => {
  let store: Store, wayA: string, stId: string, facId: string;

  beforeEach(() => {
    store = createEditorStore();
    wayA = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(wayA, [-115.2, 36.1]);
    store.getState().addWayPoint(wayA, [-115.1, 36.1]);
    store.getState().finishWay();
    stId = store.getState().addStation([-115.25, 36.05]); // free-floating, not anchored to wayA
    facId = store.getState().addFacility('entrance', [-115.15, 36.2]);
  });

  describe('wayA and the station selected', () => {
    beforeEach(() => {
      store.getState().toggleMultiSelect({ kind: 'way', id: wayA });
      store.getState().toggleMultiSelect({ kind: 'station', id: stId });
    });

    it('toggleMultiSelect builds up the group', () => {
      expect(store.getState().multiSelection).toHaveLength(2);
    });

    it('multi-select clears the single Inspector selection', () => {
      expect(store.getState().selection).toBeNull();
    });

    describe('toggling the already-selected station off, then back on with the facility', () => {
      beforeEach(() => {
        store.getState().toggleMultiSelect({ kind: 'station', id: stId }); // removes it
      });

      it('toggling an already-selected item removes it', () => {
        expect(store.getState().multiSelection).toHaveLength(1);
      });

      describe('re-adding the station, then the facility', () => {
        beforeEach(() => {
          store.getState().toggleMultiSelect({ kind: 'station', id: stId });
          store.getState().toggleMultiSelect({ kind: 'facility', id: facId });
        });

        it('group now has all 3 kinds', () => {
          expect(store.getState().multiSelection).toHaveLength(3);
        });

        describe('nudging the group', () => {
          let before: TransitSystem;

          beforeEach(() => {
            before = store.getState().system;
            store.getState().nudgeMultiSelection(0.01, 0.02);
          });

          it('nudge moves every point of a selected way', () => {
            const s = store.getState().system;
            expect(must(s.ways.find((w) => w.id === wayA)).points[0][0]).toBe(
              must(before.ways.find((w) => w.id === wayA)).points[0][0] + 0.01,
            );
          });

          it('nudge moves a selected free-floating station', () => {
            const s = store.getState().system;
            expect(must(s.stations.find((st) => st.id === stId)).coord[0]).toBe(
              must(before.stations.find((st) => st.id === stId)).coord[0] + 0.01,
            );
          });

          it("nudge moves a selected facility's point geometry", () => {
            const s = store.getState().system;
            const now = must(s.facilities.find((f) => f.id === facId)).geometry as [number, number];
            const was = must(before.facilities.find((f) => f.id === facId)).geometry as [
              number,
              number,
            ];
            expect(now[1]).toBe(was[1] + 0.02);
          });

          describe('a station anchored to a co-selected way', () => {
            // A station anchored to a way that's ALSO in the group must not be
            // double-moved — it already follows via the way's own reanchor.
            let anchoredSt: string, wayPointBefore: LngLat;

            beforeEach(() => {
              anchoredSt = store.getState().addStation([-115.15, 36.1], { wayId: wayA, t: 0.5 });
              store.getState().toggleMultiSelect({ kind: 'station', id: anchoredSt });
              wayPointBefore = must(store.getState().system.ways.find((w) => w.id === wayA))
                .points[0];
              store.getState().nudgeMultiSelection(0.005, 0.005);
            });

            it("a station anchored to a co-selected way follows the way's own reanchor, not a second direct nudge", () => {
              const s = store.getState().system;
              const way = must(s.ways.find((w) => w.id === wayA));
              const expected = pointAtT(resolveWayPath(way), 0.5);
              const actual = must(s.stations.find((st) => st.id === anchoredSt)).coord;
              expect(Math.abs(actual[0] - expected[0])).toBeLessThan(1e-9);
              expect(Math.abs(actual[1] - expected[1])).toBeLessThan(1e-9);
            });

            it('the way itself did move', () => {
              const s = store.getState().system;
              expect(must(s.ways.find((w) => w.id === wayA)).points[0][0]).not.toBe(
                wayPointBefore[0],
              );
            });

            it('group still has 4 members before bulk delete', () => {
              expect(store.getState().multiSelection).toHaveLength(4);
            });

            describe('after deleteMultiSelection', () => {
              beforeEach(() => {
                store.getState().deleteMultiSelection();
              });

              it('bulk delete removes the way', () => {
                expect(store.getState().system.ways.some((w) => w.id === wayA)).toBe(false);
              });

              it('bulk delete removes both stations', () => {
                const s = store.getState().system;
                expect(s.stations.some((st) => st.id === stId || st.id === anchoredSt)).toBe(false);
              });

              it('bulk delete removes the facility', () => {
                expect(store.getState().system.facilities.some((f) => f.id === facId)).toBe(false);
              });

              it('bulk delete clears the group', () => {
                expect(store.getState().multiSelection).toHaveLength(0);
              });
            });
          });
        });
      });
    });
  });
});
