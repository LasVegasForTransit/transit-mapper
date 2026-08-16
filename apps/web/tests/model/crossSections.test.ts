// Converted from apps/web/tests/verify.test.ts lines 1453-1659 (5 sections).
import { beforeEach, describe, expect, it } from 'vitest';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { modesForWayType, MODES, wayType } from '@transitmapper/core/model/catalog';
import { serviceWayIds, squareFootprint } from '@transitmapper/core/model/geo';
import { wayCapacity } from '@transitmapper/core/model/profile';
import { createEditorStore } from '../../src/editor/store';
import { buildFeatures } from '../../src/map/layers';

describe('modes + grade (infrastructure vertical alignment)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let gc: string;

  beforeEach(() => {
    store = createEditorStore();
    gc = store.getState().beginWay('heavyRail', 'straight');
    store.getState().addWayPoint(gc, [-115.2, 36.1]);
    store.getState().addWayPoint(gc, [-115.0, 36.1]);
    store.getState().finishWay();
  });

  const way = () => store.getState().system.ways.find((w) => w.id === gc)!;

  it('subway is a valid mode', () => {
    const svc = store.getState().system.services.find((s) => serviceWayIds(s).includes(gc))!;
    expect(
      svc.modeId === 'subway' || modesForWayType('heavyRail').some((m) => m.id === svc.modeId),
    ).toBe(true);
  });

  it('way defaults to at grade', () => {
    expect(way().grade).toBe('atGrade');
  });

  it('setWayGrade sets the grade', () => {
    store.getState().setWayGrade(gc, 'underground');
    expect(way().grade).toBe('underground');
  });

  it('parse round-trips way grade', () => {
    store.getState().setWayGrade(gc, 'underground');
    const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
    expect(round.ways[0].grade).toBe('underground');
  });

  it('parse defaults missing grade to at grade', () => {
    const noGrade = parseSystem({
      version: 3,
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
      services: [],
      stations: [],
      facilities: [],
      groups: [],
    });
    expect(noGrade.ways[0].grade).toBe('atGrade');
  });

  it("parse defaults missing capacity from the way type's catalog default", () => {
    const noGrade = parseSystem({
      version: 3,
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
      services: [],
      stations: [],
      facilities: [],
      groups: [],
    });
    expect(wayCapacity(noGrade.ways[0])).toBe(wayType('lightRail').defaultCapacity);
  });
});

describe('P2: physical cross-sections — capacity fans a way into that many parallel lane/track features, Infrastructure-view only', () => {
  let store: ReturnType<typeof createEditorStore>;
  let road: string;

  beforeEach(() => {
    store = createEditorStore();
    road = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(road, [-115.2, 36.1]);
    store.getState().addWayPoint(road, [-115.1, 36.1]);
    store.getState().finishWay();
    store.getState().setWayCapacity(road, 4);
  });

  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };

  it('setWayCapacity updates the way', () => {
    expect(wayCapacity(store.getState().system.ways.find((w) => w.id === road)!)).toBe(4);
  });

  it('setWayCapacity clamps to a minimum of 1', () => {
    store.getState().setWayCapacity(road, 0);
    expect(wayCapacity(store.getState().system.ways.find((w) => w.id === road)!)).toBe(1);
  });

  it('infrastructure view fans a 4-lane road into 4 offset features', () => {
    const infra = buildFeatures(store.getState().system, null, [], {
      viewMode: 'infrastructure',
      ...filters,
    });
    const roadFeatures = infra.ways.features.filter((f) => f.properties?.id === road);
    expect(roadFeatures.length).toBe(4);
  });

  it('each lane gets a distinct offset', () => {
    const infra = buildFeatures(store.getState().system, null, [], {
      viewMode: 'infrastructure',
      ...filters,
    });
    const roadFeatures = infra.ways.features.filter((f) => f.properties?.id === road);
    const offsets = new Set(roadFeatures.map((f) => f.properties?.offset));
    expect(offsets.size).toBe(4);
  });

  // Network view is service-focused — a bare road's infra line (unserved) is
  // hidden entirely, and a road's own infra line stays hidden even once
  // served (only the colored service line shows) — capacity never fans out.
  it("network view hides a bare way's infra line regardless of capacity", () => {
    const net = buildFeatures(store.getState().system, null, [], {
      viewMode: 'network',
      ...filters,
    });
    expect(net.ways.features.filter((f) => f.properties?.id === road).length).toBe(0);
  });

  it("network view keeps a served way's infra line hidden too", () => {
    store.getState().addServiceToWay(road);
    const netServed = buildFeatures(store.getState().system, null, [], {
      viewMode: 'network',
      ...filters,
    });
    expect(netServed.ways.features.filter((f) => f.properties?.id === road).length).toBe(0);
  });

  it('network view renders the service itself regardless of capacity', () => {
    const svc = store.getState().addServiceToWay(road)!;
    const netServed = buildFeatures(store.getState().system, null, [], {
      viewMode: 'network',
      ...filters,
    });
    expect(netServed.services.features.some((f) => f.properties?.serviceId === svc)).toBe(true);
  });
});

describe('P3: station footprints & platforms', () => {
  let store: ReturnType<typeof createEditorStore>;
  let stId: string;

  beforeEach(() => {
    store = createEditorStore();
    stId = store.getState().addStation([-115.15, 36.1]);
  });

  const withFootprint = () => store.getState().system.stations.find((s) => s.id === stId)!;

  it('station starts with no footprint', () => {
    expect(store.getState().system.stations[0].footprint).toBeUndefined();
  });

  it('addStationFootprint gives it a 4-corner default square', () => {
    store.getState().addStationFootprint(stId);
    expect(withFootprint().footprint?.length).toBe(4);
  });

  it('squareFootprint is centered on its input coord', () => {
    const square = squareFootprint([-115.15, 36.1], 30);
    expect(Math.abs((square[0][0] + square[2][0]) / 2 - -115.15)).toBeLessThan(1e-9);
  });

  it('moveFootprintPoint edits one corner', () => {
    store.getState().addStationFootprint(stId);
    store.getState().moveFootprintPoint(stId, 0, [-115.1501, 36.1001]);
    expect(withFootprint().footprint![0][0]).toBe(-115.1501);
  });

  it('addPlatform adds a platform to the station', () => {
    store.getState().addStationFootprint(stId);
    const platformId = store.getState().addPlatform(stId);
    expect(withFootprint().platforms?.length).toBe(1);
    expect(withFootprint().platforms![0].id).toBe(platformId);
  });

  it('movePlatformPoint edits one platform corner', () => {
    store.getState().addStationFootprint(stId);
    const platformId = store.getState().addPlatform(stId);
    store.getState().movePlatformPoint(stId, platformId, 1, [-115.14, 36.09]);
    expect(withFootprint().platforms![0].points[1][0]).toBe(-115.14);
  });

  it('deletePlatform removes it', () => {
    store.getState().addStationFootprint(stId);
    const platformId = store.getState().addPlatform(stId);
    store.getState().deletePlatform(stId, platformId);
    expect(withFootprint().platforms?.length).toBe(0);
  });

  it('deleteStationFootprint clears the footprint (and any platforms)', () => {
    store.getState().addStationFootprint(stId);
    store.getState().addPlatform(stId);
    store.getState().deleteStationFootprint(stId);
    expect(withFootprint().footprint).toBeUndefined();
  });
});

describe('P3: catalog-typed facilities', () => {
  let store: ReturnType<typeof createEditorStore>;
  let facId: string;

  beforeEach(() => {
    store = createEditorStore();
    facId = store.getState().addFacility('bikeDock', [-115.16, 36.12]);
  });

  it('addFacility creates it and selects it', () => {
    expect(store.getState().system.facilities.length).toBe(1);
    expect(store.getState().selection?.kind).toBe('facility');
  });

  it('facility keeps its catalog type', () => {
    expect(store.getState().system.facilities[0].typeId).toBe('bikeDock');
  });

  it('moveFacility updates its geometry', () => {
    store.getState().moveFacility(facId, [-115.161, 36.121]);
    expect((store.getState().system.facilities[0].geometry as [number, number])[0]).toBe(-115.161);
  });

  it('setFacilityName renames it', () => {
    store.getState().setFacilityName(facId, 'Main entrance dock');
    expect(store.getState().system.facilities[0].name).toBe('Main entrance dock');
  });

  it('deleteFacility removes it and clears the selection', () => {
    store.getState().deleteFacility(facId);
    expect(store.getState().system.facilities.length).toBe(0);
    expect(store.getState().selection).toBeNull();
  });
});

describe('P3: grouping (station complexes / line families)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let a: string;
  let b: string;
  let c: string;
  let groupId: string;

  beforeEach(() => {
    store = createEditorStore();
    a = store.getState().addStation([-115.2, 36.1]);
    b = store.getState().addStation([-115.2001, 36.1001]);
    c = store.getState().addStation([-115.2002, 36.1002]);
    groupId = store.getState().createGroup([a, b], 'Downtown complex');
  });

  it('createGroup bundles the given members', () => {
    expect(store.getState().system.groups[0].memberIds.length).toBe(2);
  });

  it('addGroupMember adds a third member', () => {
    store.getState().addGroupMember(groupId, c);
    expect(store.getState().system.groups[0].memberIds).toContain(c);
  });

  it('addGroupMember is idempotent (no duplicate)', () => {
    store.getState().addGroupMember(groupId, c);
    store.getState().addGroupMember(groupId, c);
    expect(store.getState().system.groups[0].memberIds.filter((m) => m === c).length).toBe(1);
  });

  it('removeGroupMember removes just that member', () => {
    store.getState().removeGroupMember(groupId, b);
    expect(store.getState().system.groups[0].memberIds).not.toContain(b);
    expect(store.getState().system.groups[0].memberIds).toContain(a);
  });

  it('renameGroup renames it', () => {
    store.getState().renameGroup(groupId, 'Renamed complex');
    expect(store.getState().system.groups[0].name).toBe('Renamed complex');
  });

  it('deleteGroup removes it', () => {
    store.getState().deleteGroup(groupId);
    expect(store.getState().system.groups.length).toBe(0);
  });
});
