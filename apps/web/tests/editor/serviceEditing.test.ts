import { beforeEach, describe, expect, it } from 'vitest';
import { MODE_ORDER } from '@transitmapper/core/model/catalog';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { patternWayIds, primaryAnchor, serviceWayIds } from '@transitmapper/core/model/geo';
import { createEditorStore } from '../../src/editor/store';
import { buildFeatures } from '../support/testRenderPresentation.test';

// beginWay(typeId, ...) without an explicit setDraftMode(...) call attaches a
// service using the store's default draftModeId ('lightRail', which is
// compatible with the 'road' way type) — see
// src/editor/store/internal-operations/way-creation.ts's compatibleModeId.
// Cases below that don't set the mode explicitly are implicitly exercising
// lightRail, not a specific documented choice.

function must<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('expected a defined value');
  return value;
}

describe('splitWayAt: splits infrastructure, keeps riding services whole, re-snaps stops, and links the split point as a real junction', () => {
  describe('a 3-point trunk way carrying a service and two stops, split at the middle control point', () => {
    let store: ReturnType<typeof createEditorStore>;
    let trunk: string;
    let svc: string;
    let westStop: string;
    let eastStop: string;

    beforeEach(() => {
      store = createEditorStore();
      trunk = must(store.commands.ways.beginWay('lightRail', 'straight'));
      store.commands.ways.addWayPoint(trunk, [-115.3, 36.1]);
      store.commands.ways.addWayPoint(trunk, [-115.2, 36.1]);
      store.commands.ways.addWayPoint(trunk, [-115.1, 36.1]);
      store.commands.ways.finishWay();
      store.commands.ways.setWayGrade(trunk, 'underground');
      svc = must(
        store.getState().system.services.find((sv) => serviceWayIds(sv).includes(trunk)),
      ).id;
      // A stop riding each half, so the re-snap can be checked on both sides.
      westStop = must(store.commands.stops.addStop([-115.25, 36.1], { wayId: trunk, t: 0.25 }));
      eastStop = must(store.commands.stops.addStop([-115.15, 36.1], { wayId: trunk, t: 0.75 }));

      store.commands.ways.splitWayAt(trunk, 1); // split at the middle control point
    });

    it('splitWayAt produces exactly one new way', () => {
      expect(store.getState().system.ways).toHaveLength(2);
    });

    it('the first half keeps the original id and its first 2 points', () => {
      const wayA = must(store.getState().system.ways.find((w) => w.id === trunk));
      expect(wayA.points).toHaveLength(2);
    });

    it('the second half gets a new id with the remaining 2 points', () => {
      const wayB = must(store.getState().system.ways.find((w) => w.id !== trunk));
      expect(wayB.points).toHaveLength(2);
    });

    it('the second half inherits grade/type from the original', () => {
      const wayB = must(store.getState().system.ways.find((w) => w.id !== trunk));
      expect(wayB.grade).toBe('underground');
      expect(wayB.typeId).toBe('lightRail');
    });

    it("the riding service's pattern now runs over both halves, in order", () => {
      const s = store.getState().system;
      const wayB = must(s.ways.find((w) => w.id !== trunk));
      const service = must(s.services.find((sv) => sv.id === svc));
      expect(patternWayIds(service.path)).toEqual([trunk, wayB.id]);
    });

    it('the split point becomes a real junction node', () => {
      const s = store.getState().system;
      const wayB = must(s.ways.find((w) => w.id !== trunk));
      expect(
        s.nodes.some(
          (n) =>
            n.refs.length === 2 &&
            n.refs.some((r) => r.wayId === trunk) &&
            n.refs.some((r) => r.wayId === wayB.id),
        ),
      ).toBe(true);
    });

    it('a stop west of the split re-snaps onto the first half', () => {
      const west = must(store.getState().system.stops.find((st) => st.id === westStop));
      expect(primaryAnchor(west)?.wayId).toBe(trunk);
    });

    it('a stop east of the split re-snaps onto the second half', () => {
      const s = store.getState().system;
      const wayB = must(s.ways.find((w) => w.id !== trunk));
      const east = must(s.stops.find((st) => st.id === eastStop));
      expect(primaryAnchor(east)?.wayId).toBe(wayB.id);
    });

    describe('moving the shared split point', () => {
      // Still cascades to both halves (it's a real Node now, not just two ways
      // that happen to touch).
      beforeEach(() => {
        store.commands.ways.moveWayPoint(trunk, 1, [-115.2, 36.05]);
      });

      it('the split point still cascades on move, like any other junction', () => {
        const s = store.getState().system;
        const wayB = must(s.ways.find((w) => w.id !== trunk));
        expect(must(s.ways.find((w) => w.id === trunk)).points[1][1]).toBe(36.05);
        expect(must(s.ways.find((w) => w.id === wayB.id)).points[0][1]).toBe(36.05);
      });
    });
  });

  it('splitting at an endpoint is a no-op', () => {
    // Splitting at an endpoint (nothing to split off) is a documented no-op.
    const store = createEditorStore();
    const short = must(store.commands.ways.beginWay('lightRail', 'straight'));
    store.commands.ways.addWayPoint(short, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(short, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    store.commands.ways.splitWayAt(short, 0);
    expect(store.getState().system.ways).toHaveLength(1);
  });
});

describe('a service carries an optional frequency and span that round-trip through parse', () => {
  let store: ReturnType<typeof createEditorStore>;
  let svcId: string;

  beforeEach(() => {
    store = createEditorStore();
    const wayId = must(store.commands.ways.beginWay('lightRail', 'straight'));
    store.commands.ways.addWayPoint(wayId, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(wayId, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    svcId = store.getState().system.services[0].id;
  });

  it('frequency starts at the default headway', () => {
    // A fresh line now seeds a sensible default headway (see store.ts's
    // DEFAULT_FREQUENCY_MINUTES) instead of starting unset.
    expect(store.getState().system.services[0].frequencyMinutes).toBe(10);
  });

  describe('after setting frequency and span', () => {
    beforeEach(() => {
      store.commands.services.setServiceFrequency(svcId, 8);
      store.commands.services.setServiceSpan(svcId, '05:00', '01:00');
    });

    it('setServiceFrequency sets the peak headway', () => {
      const svc = must(store.getState().system.services.find((s) => s.id === svcId));
      expect(svc.frequencyMinutes).toBe(8);
    });

    it("setServiceSpan sets the service's start and end", () => {
      const svc = must(store.getState().system.services.find((s) => s.id === svcId));
      expect(svc.spanStart).toBe('05:00');
      expect(svc.spanEnd).toBe('01:00');
    });

    it('frequency and span survive a round trip through parse', () => {
      const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
      const svc = must(round.services.find((s) => s.id === svcId));
      expect(svc.frequencyMinutes).toBe(8);
      expect(svc.spanStart).toBe('05:00');
      expect(svc.spanEnd).toBe('01:00');
    });

    describe('clearing the frequency', () => {
      beforeEach(() => {
        store.commands.services.setServiceFrequency(svcId, undefined);
      });

      it('frequency can be cleared back to unset', () => {
        const svc = must(store.getState().system.services.find((s) => s.id === svcId));
        expect(svc.frequencyMinutes).toBeUndefined();
      });
    });
  });
});

// A branch is a second, sibling Service under the same Line — Line owns
// identity/color, and each Service has exactly one path. Adding one is
// startAddingServiceToLine/addingServiceDraft/cancelAddingService/
// deleteService, scoped to a Line's serviceIds rather than a Service's own
// patterns.
describe('a Line can carry sibling Services that branch off a shared trunk', () => {
  describe('a trunk way with its default service', () => {
    let store: ReturnType<typeof createEditorStore>;
    let lineId: string;
    let svcId: string;

    beforeEach(() => {
      store = createEditorStore();
      const trunk = must(store.commands.ways.beginWay('lightRail', 'straight'));
      store.commands.ways.addWayPoint(trunk, [-115.3, 36.1]);
      store.commands.ways.addWayPoint(trunk, [-115.1, 36.1]);
      store.commands.ways.finishWay();
      svcId = must(
        store.getState().system.services.find((sv) => serviceWayIds(sv).includes(trunk)),
      ).id;
      lineId = must(store.getState().system.lines.find((l) => l.serviceIds.includes(svcId))).id;
    });

    it('the line starts with exactly one service', () => {
      const line = must(store.getState().system.lines.find((l) => l.id === lineId));
      expect(line.serviceIds).toHaveLength(1);
    });

    describe('after startAddingServiceToLine', () => {
      beforeEach(() => {
        store.commands.services.startAddingServiceToLine(lineId, {
          name: 'Branch',
          modeId: 'lightRail',
        });
      });

      it('startAddingServiceToLine arms the draft and switches to the way tool', () => {
        expect(store.getState().addingServiceDraft?.lineId).toBe(lineId);
        expect(store.getState().tool).toBe('way');
      });

      describe('drawing a fresh way for the branch', () => {
        // It should NOT spawn its own default line/service while armed.
        let branchWay: string;

        beforeEach(() => {
          branchWay = must(store.commands.ways.beginWay('lightRail', 'straight'));
        });

        it('drawing while armed creates no second service yet', () => {
          expect(store.getState().system.services).toHaveLength(1);
        });

        describe('finishing the branch draw', () => {
          beforeEach(() => {
            store.commands.ways.addWayPoint(branchWay, [-115.2, 36.1]);
            store.commands.ways.addWayPoint(branchWay, [-115.15, 36.2]);
            store.commands.ways.finishWay();
          });

          it('finishing the draw attaches a second, sibling service to the line', () => {
            const line = must(store.getState().system.lines.find((l) => l.id === lineId));
            expect(line.serviceIds).toHaveLength(2);
          });

          it('the new service rides the branch way', () => {
            const line = must(store.getState().system.lines.find((l) => l.id === lineId));
            const branchServiceId = must(line.serviceIds.find((id) => id !== svcId));
            const branchService = must(
              store.getState().system.services.find((s) => s.id === branchServiceId),
            );
            expect(serviceWayIds(branchService)).toContain(branchWay);
          });

          it('finishWay disarms addingServiceDraft', () => {
            expect(store.getState().addingServiceDraft).toBeNull();
          });

          it('still exactly one line (a branch, not a new line)', () => {
            expect(store.getState().system.lines).toHaveLength(1);
          });

          describe('rendering the shared trunk + branch', () => {
            it('the shared trunk renders as exactly one service line, not doubled by the branch', () => {
              const trunk = must(store.getState().system.ways.find((w) => w.id !== branchWay)).id;
              const view = {
                viewMode: 'network' as const,
                visibleModes: new Set(MODE_ORDER),
                visibleWayTypes: new Set(['lightRail']),
              };
              const fc = buildFeatures(store.getState().system, null, [], view);
              const trunkFeatures = fc.services.features.filter(
                (f) =>
                  (f.properties as { wayId: string; hitTarget?: boolean }).wayId === trunk &&
                  !f.properties?.hitTarget,
              );
              expect(trunkFeatures).toHaveLength(1);
            });

            it('the branch-only way renders its own service line too', () => {
              const view = {
                viewMode: 'network' as const,
                visibleModes: new Set(MODE_ORDER),
                visibleWayTypes: new Set(['lightRail']),
              };
              const fc = buildFeatures(store.getState().system, null, [], view);
              const branchFeatures = fc.services.features.filter(
                (f) =>
                  (f.properties as { wayId: string; hitTarget?: boolean }).wayId === branchWay &&
                  !f.properties?.hitTarget,
              );
              expect(branchFeatures).toHaveLength(1);
            });
          });

          describe('arming and cancelling a second branch', () => {
            // Cancel: no-op on the model, just clears the draft.
            beforeEach(() => {
              store.commands.services.startAddingServiceToLine(lineId, {
                name: 'Another branch',
                modeId: 'lightRail',
              });
              store.commands.services.cancelAddingService();
            });

            it('cancelAddingService clears the draft without adding a service', () => {
              expect(store.getState().addingServiceDraft).toBeNull();
              const line = must(store.getState().system.lines.find((l) => l.id === lineId));
              expect(line.serviceIds).toHaveLength(2);
            });
          });

          describe('deleteService', () => {
            let branchServiceId: string;

            beforeEach(() => {
              const line = must(store.getState().system.lines.find((l) => l.id === lineId));
              branchServiceId = must(line.serviceIds.find((id) => id !== svcId));
              store.commands.services.deleteService(branchServiceId);
            });

            it('deleteService removes a branch when 2+ services exist on the line', () => {
              const line = must(store.getState().system.lines.find((l) => l.id === lineId));
              expect(line.serviceIds).toHaveLength(1);
              expect(line.serviceIds[0]).toBe(svcId);
            });

            describe('trying to remove the last remaining service on the line', () => {
              beforeEach(() => {
                store.commands.services.deleteService(svcId);
              });

              // Patterns used to refuse to drop a service's last pattern.
              // Services don't have that guard: deleting the line's last
              // service deletes the line too (see pruneLineMembership) —
              // there is nothing left for the Line to own.
              it("deleteService on a line's last service removes the line too", () => {
                expect(store.getState().system.lines.some((l) => l.id === lineId)).toBe(false);
                expect(store.getState().system.services.some((s) => s.id === svcId)).toBe(false);
              });
            });
          });
        });
      });
    });
  });

  it('a v4 flat-wayIds service migrates into a single path', () => {
    // v4-shape (flat wayIds, no patterns) migrates into one path.
    const legacyV4 = parseSystem({
      version: 4,
      id: 'x',
      name: 'x',
      viewport: { center: [-115, 36], zoom: 10 },
      createdAt: 1,
      updatedAt: 1,
      ways: [
        {
          id: 'w',
          typeId: 'lightRail',
          points: [
            [-115.2, 36.1],
            [-115.1, 36.1],
          ],
          geometry: 'straight',
        },
      ],
      services: [{ id: 's1', name: 'Old', modeId: 'lightRail', color: '#e4572e', wayIds: ['w'] }],
      stations: [],
      facilities: [],
      groups: [],
      nodes: [],
    });
    expect(legacyV4.services).toHaveLength(1);
    expect(patternWayIds(legacyV4.services[0].path)[0]).toBe('w');
  });

  it('removeWay drops a now-pathless service entirely', () => {
    // A service with an empty path is a ghost, same as the old empty-wayIds case.
    const store = createEditorStore();
    const ghostWay = must(store.commands.ways.beginWay('lightRail', 'straight'));
    store.commands.ways.addWayPoint(ghostWay, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(ghostWay, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    const ghostSvcId = store.getState().system.services[0].id;
    store.commands.ways.deleteWay(ghostWay); // drops the way, and with it the service's only path
    expect(store.getState().system.services.some((s) => s.id === ghostSvcId)).toBe(false);
  });
});
