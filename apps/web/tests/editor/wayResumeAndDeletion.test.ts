import { describe, expect, it, beforeEach } from 'vitest';
import {
  INTERCHANGE_METERS,
  nearestOpenEndpoint,
  servedWayIds,
  serviceWayIds,
} from '@transitmapper/core/model/geo';
import type { LngLat } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';
import { mustFind } from '../support/required.test';

describe('resuming a way from its open endpoint (turnkey continuation)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let rw: string;

  beforeEach(() => {
    store = createEditorStore();
    rw = mustFind(store.commands.ways.beginWay('road', 'straight'), 'way id');
    store.commands.ways.addWayPoint(rw, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(rw, [-115.1, 36.1]);
    store.commands.ways.finishWay();
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
    store.commands.ways.resumeWay(rw);
    expect(store.getState().activeWayId).toBe(rw);
    expect(store.getState().system.ways.length).toBe(1);
  });

  it('extending at the end appends', () => {
    store.commands.ways.resumeWay(rw);
    store.commands.ways.addWayPoint(rw, [-115.0, 36.1]);
    store.commands.ways.insertWayPoint(rw, 0, [-115.3, 36.1]);
    const extended = mustFind(
      store.getState().system.ways.find((w) => w.id === rw),
      'way',
    );
    expect(extended.points[extended.points.length - 1][0]).toBe(-115.0);
  });

  it('extending at the start prepends', () => {
    store.commands.ways.resumeWay(rw);
    store.commands.ways.addWayPoint(rw, [-115.0, 36.1]);
    store.commands.ways.insertWayPoint(rw, 0, [-115.3, 36.1]);
    const extended = mustFind(
      store.getState().system.ways.find((w) => w.id === rw),
      'way',
    );
    expect(extended.points[0][0]).toBe(-115.3);
  });

  it('resuming a way never creates a second service', () => {
    store.commands.ways.resumeWay(rw);
    store.commands.ways.addWayPoint(rw, [-115.0, 36.1]);
    store.commands.ways.insertWayPoint(rw, 0, [-115.3, 36.1]);
    const servicesOnWay = store
      .getState()
      .system.services.filter((s) => serviceWayIds(s).includes(rw));
    expect(servicesOnWay.length).toBe(1);
  });
});

describe("interchange emerges where a station sits on two ways' services", () => {
  it('a station at a crossing is served by two services', () => {
    const store = createEditorStore();
    const la = mustFind(store.commands.ways.beginWay('lightRail', 'straight'), 'way id');
    store.commands.ways.addWayPoint(la, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(la, [-115.0, 36.1]);
    store.commands.ways.finishWay();
    const lb = mustFind(store.commands.ways.beginWay('road', 'straight'), 'way id');
    store.commands.ways.addWayPoint(lb, [-115.1, 36.0]);
    store.commands.ways.addWayPoint(lb, [-115.1, 36.2]);
    store.commands.ways.finishWay();
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
    dc = mustFind(store.commands.ways.beginWay('road', 'straight'), 'way id');
    store.commands.ways.addWayPoint(dc, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(dc, [-115.0, 36.1]);
    store.commands.ways.finishWay();
    store.commands.stops.addStop([-115.1, 36.1], { wayId: dc, t: 0.5 });
    store.commands.ways.deleteWay(dc);
  });

  it('deleting a way removes its service', () => {
    expect(store.getState().system.services.length).toBe(0);
  });

  it('deleting a way removes its stations', () => {
    expect(store.getState().system.stops.length).toBe(0);
  });
});

describe('deleting one service leaves the way and other services', () => {
  let store: ReturnType<typeof createEditorStore>;
  let kc: string;

  beforeEach(() => {
    store = createEditorStore();
    kc = mustFind(store.commands.ways.beginWay('lightRail', 'straight'), 'way id');
    store.commands.ways.addWayPoint(kc, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(kc, [-115.0, 36.1]);
    store.commands.ways.finishWay();
    const extra = store.commands.services.addServiceToWay(kc);
    store.commands.services.deleteService(mustFind(extra, 'extra service id'));
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
    ec = mustFind(store.commands.ways.beginWay('road', 'straight'), 'way id');
    (
      [
        [-115.3, 36.1],
        [-115.2, 36.1],
        [-115.1, 36.1],
        [-115.0, 36.1],
      ] as LngLat[]
    ).forEach((p) => store.commands.ways.addWayPoint(ec, p));
    store.commands.ways.finishWay();
    before = mustFind(
      store.getState().system.ways.find((w) => w.id === ec),
      'way',
    ).points.length;
    store.commands.ways.deleteWayPoint(ec, 1);
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
