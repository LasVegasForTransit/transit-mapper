import { describe, expect, it, beforeEach } from 'vitest';
import {
  INTERCHANGE_METERS,
  nearestOpenEndpoint,
  servedWayIds,
  serviceWayIds,
} from '@transitmapper/core/model/geo';
import type { LngLat } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';

/** Throw-guard for a lookup this test's own setup guarantees succeeds — turns
 *  a silent `undefined`/`null` into a clear failure at the point of use
 *  instead of a confusing crash further down the assertion. */
function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

describe('resuming a way from its open endpoint (turnkey continuation)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let rw: string;

  beforeEach(() => {
    store = createEditorStore();
    rw = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(rw, [-115.2, 36.1]);
    store.getState().addWayPoint(rw, [-115.1, 36.1]);
    store.getState().finishWay();
  });

  it("nearestOpenEndpoint finds the way's end", () => {
    const endHit = nearestOpenEndpoint(
      store.getState().system.ways,
      [-115.1002, 36.1001],
      500,
      'road',
    );
    expect(endHit?.wayId).toBe(rw);
    expect(endHit?.end).toBe('end');
  });

  it("nearestOpenEndpoint finds the way's start", () => {
    const startHit = nearestOpenEndpoint(
      store.getState().system.ways,
      [-115.2001, 36.0999],
      500,
      'road',
    );
    expect(startHit?.wayId).toBe(rw);
    expect(startHit?.end).toBe('start');
  });

  it('nearestOpenEndpoint respects the type filter', () => {
    const wrongType = nearestOpenEndpoint(
      store.getState().system.ways,
      [-115.1002, 36.1001],
      500,
      'bike',
    );
    expect(wrongType).toBeNull();
  });

  it('nearestOpenEndpoint returns null outside the radius', () => {
    const farAway = nearestOpenEndpoint(store.getState().system.ways, [-114.5, 36.1], 500, 'road');
    expect(farAway).toBeNull();
  });

  // Resuming appends at the end and prepends at the start — same way, no new service.
  it('resumeWay makes it the active way without creating a new one', () => {
    store.getState().resumeWay(rw);
    expect(store.getState().activeWayId).toBe(rw);
    expect(store.getState().system.ways.length).toBe(1);
  });

  it('extending at the end appends', () => {
    store.getState().resumeWay(rw);
    store.getState().addWayPoint(rw, [-115.0, 36.1]);
    store.getState().insertWayPoint(rw, 0, [-115.3, 36.1]);
    const extended = mustFind(
      store.getState().system.ways.find((w) => w.id === rw),
      'way',
    );
    expect(extended.points[extended.points.length - 1][0]).toBe(-115.0);
  });

  it('extending at the start prepends', () => {
    store.getState().resumeWay(rw);
    store.getState().addWayPoint(rw, [-115.0, 36.1]);
    store.getState().insertWayPoint(rw, 0, [-115.3, 36.1]);
    const extended = mustFind(
      store.getState().system.ways.find((w) => w.id === rw),
      'way',
    );
    expect(extended.points[0][0]).toBe(-115.3);
  });

  it('resuming a way never creates a second service', () => {
    store.getState().resumeWay(rw);
    store.getState().addWayPoint(rw, [-115.0, 36.1]);
    store.getState().insertWayPoint(rw, 0, [-115.3, 36.1]);
    const servicesOnWay = store
      .getState()
      .system.services.filter((s) => serviceWayIds(s).includes(rw));
    expect(servicesOnWay.length).toBe(1);
  });
});

describe("interchange emerges where a station sits on two ways' services", () => {
  it('a station at a crossing is served by two services', () => {
    const store = createEditorStore();
    const la = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(la, [-115.2, 36.1]);
    store.getState().addWayPoint(la, [-115.0, 36.1]);
    store.getState().finishWay();
    const lb = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(lb, [-115.1, 36.0]);
    store.getState().addWayPoint(lb, [-115.1, 36.2]);
    store.getState().finishWay();
    const near = new Set(
      servedWayIds([-115.1, 36.1], store.getState().system.ways, INTERCHANGE_METERS),
    );
    const services = store
      .getState()
      .system.services.filter((s) => serviceWayIds(s).some((w) => near.has(w)));
    expect(services.length).toBe(2);
  });
});

describe('deleting a way removes its services and stations', () => {
  let store: ReturnType<typeof createEditorStore>;
  let dc: string;

  beforeEach(() => {
    store = createEditorStore();
    dc = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(dc, [-115.2, 36.1]);
    store.getState().addWayPoint(dc, [-115.0, 36.1]);
    store.getState().finishWay();
    store.getState().addStation([-115.1, 36.1], { wayId: dc, t: 0.5 });
    store.getState().deleteWay(dc);
  });

  it('deleting a way removes its service', () => {
    expect(store.getState().system.services.length).toBe(0);
  });

  it('deleting a way removes its stations', () => {
    expect(store.getState().system.stations.length).toBe(0);
  });
});

describe('deleting one service leaves the way and other services', () => {
  let store: ReturnType<typeof createEditorStore>;
  let kc: string;

  beforeEach(() => {
    store = createEditorStore();
    kc = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(kc, [-115.2, 36.1]);
    store.getState().addWayPoint(kc, [-115.0, 36.1]);
    store.getState().finishWay();
    const extra = store.getState().addServiceToWay(kc);
    store.getState().deleteService(mustFind(extra, 'extra service id'));
  });

  it('deleting a service keeps the way', () => {
    expect(store.getState().system.ways.some((w) => w.id === kc)).toBe(true);
  });

  it('deleting a service keeps the other services', () => {
    const servicesOnWay = store
      .getState()
      .system.services.filter((s) => serviceWayIds(s).includes(kc));
    expect(servicesOnWay.length).toBe(1);
  });
});

describe('removing part of a way (the eraser deletes control points)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let ec: string;
  let before: number;

  beforeEach(() => {
    store = createEditorStore();
    ec = store.getState().beginWay('road', 'straight');
    (
      [
        [-115.3, 36.1],
        [-115.2, 36.1],
        [-115.1, 36.1],
        [-115.0, 36.1],
      ] as LngLat[]
    ).forEach((p) => store.getState().addWayPoint(ec, p));
    store.getState().finishWay();
    before = mustFind(
      store.getState().system.ways.find((w) => w.id === ec),
      'way',
    ).points.length;
    store.getState().deleteWayPoint(ec, 1);
  });

  it('deleteWayPoint removes one control point', () => {
    const w = mustFind(
      store.getState().system.ways.find((ww) => ww.id === ec),
      'way',
    );
    expect(before).toBe(4);
    expect(w.points.length).toBe(3);
  });

  it('the right control point was removed', () => {
    const w = mustFind(
      store.getState().system.ways.find((ww) => ww.id === ec),
      'way',
    );
    expect(w.points[1][0]).toBe(-115.1);
  });
});
