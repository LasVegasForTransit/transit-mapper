import { beforeEach, describe, expect, it } from 'vitest';
import { MODE_ORDER } from '@transitmapper/core/model/catalog';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { patternWayIds, primaryAnchor, serviceWayIds } from '@transitmapper/core/model/geo';
import { createEditorStore } from '../../src/editor/store';
import { buildFeatures } from '../../src/map/layers';

function must<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('expected a defined value');
  return value;
}

describe('splitWayAt: splits infrastructure, keeps riding services whole, re-snaps stations, and links the split point as a real junction', () => {
  describe('a 3-point trunk way carrying a service and two stations, split at the middle control point', () => {
    let store: ReturnType<typeof createEditorStore>;
    let trunk: string;
    let svc: string;
    let westStop: string;
    let eastStop: string;

    beforeEach(() => {
      store = createEditorStore();
      trunk = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(trunk, [-115.3, 36.1]);
      store.getState().addWayPoint(trunk, [-115.2, 36.1]);
      store.getState().addWayPoint(trunk, [-115.1, 36.1]);
      store.getState().finishWay();
      store.getState().setWayGrade(trunk, 'underground');
      svc = must(
        store.getState().system.services.find((sv) => serviceWayIds(sv).includes(trunk)),
      ).id;
      // A station riding each half, so the re-snap can be checked on both sides.
      westStop = store.getState().addStation([-115.25, 36.1], { wayId: trunk, t: 0.25 });
      eastStop = store.getState().addStation([-115.15, 36.1], { wayId: trunk, t: 0.75 });

      store.getState().splitWayAt(trunk, 1); // split at the middle control point
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
      expect(patternWayIds(service.patterns[0])).toEqual([trunk, wayB.id]);
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

    it('a station west of the split re-snaps onto the first half', () => {
      const west = must(store.getState().system.stations.find((st) => st.id === westStop));
      expect(primaryAnchor(west)?.wayId).toBe(trunk);
    });

    it('a station east of the split re-snaps onto the second half', () => {
      const s = store.getState().system;
      const wayB = must(s.ways.find((w) => w.id !== trunk));
      const east = must(s.stations.find((st) => st.id === eastStop));
      expect(primaryAnchor(east)?.wayId).toBe(wayB.id);
    });

    describe('moving the shared split point', () => {
      // Still cascades to both halves (it's a real Node now, not just two ways
      // that happen to touch).
      beforeEach(() => {
        store.getState().moveWayPoint(trunk, 1, [-115.2, 36.05]);
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
    const short = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(short, [-115.2, 36.1]);
    store.getState().addWayPoint(short, [-115.1, 36.1]);
    store.getState().finishWay();
    store.getState().splitWayAt(short, 0);
    expect(store.getState().system.ways).toHaveLength(1);
  });
});

describe('Service frequency + span: additive fields, round-trip through parse', () => {
  let store: ReturnType<typeof createEditorStore>;
  let svcId: string;

  beforeEach(() => {
    store = createEditorStore();
    const wayId = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(wayId, [-115.2, 36.1]);
    store.getState().addWayPoint(wayId, [-115.1, 36.1]);
    store.getState().finishWay();
    svcId = store.getState().system.services[0].id;
  });

  it('frequency starts at the default headway', () => {
    // A fresh line now seeds a sensible default headway (see store.ts's
    // DEFAULT_FREQUENCY_MINUTES) instead of starting unset.
    expect(store.getState().system.services[0].frequencyMinutes).toBe(10);
  });

  describe('after setting frequency and span', () => {
    beforeEach(() => {
      store.getState().setServiceFrequency(svcId, 8);
      store.getState().setServiceSpan(svcId, '05:00', '01:00');
    });

    it('setServiceFrequency sets the peak headway', () => {
      const svc = must(store.getState().system.services.find((s) => s.id === svcId));
      expect(svc.frequencyMinutes).toBe(8);
    });

    it('setServiceSpan sets start/end', () => {
      const svc = must(store.getState().system.services.find((s) => s.id === svcId));
      expect(svc.spanStart).toBe('05:00');
      expect(svc.spanEnd).toBe('01:00');
    });

    it('frequency/span round-trip through parse', () => {
      const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
      const svc = must(round.services.find((s) => s.id === svcId));
      expect(svc.frequencyMinutes).toBe(8);
      expect(svc.spanStart).toBe('05:00');
      expect(svc.spanEnd).toBe('01:00');
    });

    describe('clearing the frequency', () => {
      beforeEach(() => {
        store.getState().setServiceFrequency(svcId, undefined);
      });

      it('frequency can be cleared back to unset', () => {
        const svc = must(store.getState().system.services.find((s) => s.id === svcId));
        expect(svc.frequencyMinutes).toBeUndefined();
      });
    });
  });
});

describe('service patterns/branches: a service can have 2+ paths sharing one identity, drawn via startAddingPattern/finishWay, rendered as one shared line on a common trunk and separate lines past the branch point', () => {
  describe('a trunk way with its default service', () => {
    let store: ReturnType<typeof createEditorStore>;
    let svcId: string;

    beforeEach(() => {
      store = createEditorStore();
      const trunk = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(trunk, [-115.3, 36.1]);
      store.getState().addWayPoint(trunk, [-115.1, 36.1]);
      store.getState().finishWay();
      svcId = must(
        store.getState().system.services.find((sv) => serviceWayIds(sv).includes(trunk)),
      ).id;
    });

    it('service starts with exactly one pattern', () => {
      const svc = must(store.getState().system.services.find((s) => s.id === svcId));
      expect(svc.patterns).toHaveLength(1);
    });

    describe('after startAddingPattern', () => {
      beforeEach(() => {
        store.getState().startAddingPattern(svcId);
      });

      it('startAddingPattern arms the flag and switches to the way tool', () => {
        expect(store.getState().addingPatternForServiceId).toBe(svcId);
        expect(store.getState().tool).toBe('way');
      });

      describe('drawing a fresh way for the branch', () => {
        // It should NOT spawn its own service.
        let branchWay: string;

        beforeEach(() => {
          branchWay = store.getState().beginWay('lightRail', 'straight');
        });

        it('drawing while armed creates no second service', () => {
          expect(store.getState().system.services).toHaveLength(1);
        });

        describe('finishing the branch draw', () => {
          beforeEach(() => {
            store.getState().addWayPoint(branchWay, [-115.2, 36.1]);
            store.getState().addWayPoint(branchWay, [-115.15, 36.2]);
            store.getState().finishWay();
          });

          it('finishing the draw attaches a second pattern on the same service', () => {
            const svc = must(store.getState().system.services.find((s) => s.id === svcId));
            expect(svc.patterns).toHaveLength(2);
          });

          it('the new pattern rides the branch way', () => {
            const svc = must(store.getState().system.services.find((s) => s.id === svcId));
            expect(patternWayIds(svc.patterns[1])).toContain(branchWay);
          });

          it('finishWay disarms addingPatternForServiceId', () => {
            expect(store.getState().addingPatternForServiceId).toBeNull();
          });

          it('still exactly one service (a branch, not a new line)', () => {
            expect(store.getState().system.services).toHaveLength(1);
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

          describe('arming and cancelling a second pattern', () => {
            // Cancel: no-op on the model, just clears the flag.
            beforeEach(() => {
              store.getState().startAddingPattern(svcId);
              store.getState().cancelAddingPattern();
            });

            it('cancelAddingPattern clears the flag without adding a pattern', () => {
              expect(store.getState().addingPatternForServiceId).toBeNull();
              const svc = must(store.getState().system.services.find((s) => s.id === svcId));
              expect(svc.patterns).toHaveLength(2);
            });
          });

          describe('deletePattern', () => {
            let onlyPatternId: string;

            beforeEach(() => {
              onlyPatternId = must(store.getState().system.services.find((s) => s.id === svcId))
                .patterns[0].id;
              const branchPatternId = must(
                store.getState().system.services.find((s) => s.id === svcId),
              ).patterns[1].id;
              store.getState().deletePattern(svcId, branchPatternId);
            });

            it('deletePattern removes a branch when 2+ patterns exist', () => {
              const svc = must(store.getState().system.services.find((s) => s.id === svcId));
              expect(svc.patterns).toHaveLength(1);
              expect(svc.patterns[0].id).toBe(onlyPatternId);
            });

            describe('trying to remove the last remaining pattern', () => {
              beforeEach(() => {
                store.getState().deletePattern(svcId, onlyPatternId);
              });

              it("deletePattern refuses to remove a service's last pattern", () => {
                const svc = must(store.getState().system.services.find((s) => s.id === svcId));
                expect(svc.patterns).toHaveLength(1);
              });
            });
          });
        });
      });
    });
  });

  it('a v4 flat-wayIds service migrates into a single pattern', () => {
    // v4-shape (flat wayIds, no patterns) migrates into one pattern.
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
    expect(legacyV4.services[0].patterns).toHaveLength(1);
    expect(patternWayIds(legacyV4.services[0].patterns[0])[0]).toBe('w');
  });

  it('removeWay drops a now-patternless service entirely', () => {
    // A service with zero patterns is a ghost, same as the old empty-wayIds case.
    const store = createEditorStore();
    const ghostWay = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(ghostWay, [-115.2, 36.1]);
    store.getState().addWayPoint(ghostWay, [-115.1, 36.1]);
    store.getState().finishWay();
    const ghostSvcId = store.getState().system.services[0].id;
    store.getState().deleteWay(ghostWay); // drops the way, and with it the service's only pattern
    expect(store.getState().system.services.some((s) => s.id === ghostSvcId)).toBe(false);
  });
});
