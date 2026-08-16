import { beforeEach, describe, expect, it } from 'vitest';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { modesForWayType, MODES, wayType } from '@transitmapper/core/model/catalog';
import { serviceWayIds, squareFootprint } from '@transitmapper/core/model/geo';
import { wayCapacity } from '@transitmapper/core/model/profile';
import { createEditorStore } from '../../src/editor/store';
import {
  buildFeatures,
  renderPresentationForViewport,
} from '../support/testRenderPresentation.test';
import { mustFind } from '../support/required.test';

describe('grade tracks how a way sits relative to the ground, and defaults sensibly when absent', () => {
  let store: ReturnType<typeof createEditorStore>;
  let gc: string;

  beforeEach(() => {
    store = createEditorStore();
    gc = mustFind(store.commands.ways.beginWay('heavyRail', 'straight'), 'way id');
    store.commands.ways.addWayPoint(gc, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(gc, [-115.0, 36.1]);
    store.commands.ways.finishWay();
  });

  const way = () =>
    mustFind(
      store.getState().system.ways.find((w) => w.id === gc),
      'way',
    );

  it('subway is a valid mode', () => {
    const svc = mustFind(
      store.getState().system.services.find((s) => serviceWayIds(s).includes(gc)),
      'service',
    );
    expect(
      svc.modeId === 'subway' || modesForWayType('heavyRail').some((m) => m.id === svc.modeId),
    ).toBe(true);
  });

  it('way defaults to at grade', () => {
    expect(way().grade).toBe('atGrade');
  });

  it('setWayGrade sets the grade', () => {
    store.commands.ways.setWayGrade(gc, 'underground');
    expect(way().grade).toBe('underground');
  });

  it('parse round-trips way grade', () => {
    store.commands.ways.setWayGrade(gc, 'underground');
    const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
    expect(round.ways[0].grade).toBe('underground');
  });

  // Shared by the two "parse fills in a missing field" cases below: a
  // minimal serialized system whose one way omits everything but the
  // fields required to identify it, so parseSystem's defaulting is what's
  // under test rather than any of the values we bothered to fill in.
  const parseWayMissingOptionalFields = () =>
    parseSystem({
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
      stops: [],
      facilities: [],
      groups: [],
    });

  it('parse defaults missing grade to at grade', () => {
    const noGrade = parseWayMissingOptionalFields();
    expect(noGrade.ways[0].grade).toBe('atGrade');
  });

  it("parse defaults missing capacity from the way type's catalog default", () => {
    const noGrade = parseWayMissingOptionalFields();
    expect(wayCapacity(noGrade.ways[0])).toBe(wayType('lightRail').defaultCapacity);
  });
});

describe('capacity fans a way out into that many parallel lane features, but only in infrastructure view', () => {
  let store: ReturnType<typeof createEditorStore>;
  let road: string;

  beforeEach(() => {
    store = createEditorStore();
    road = mustFind(store.commands.ways.beginWay('road', 'straight'), 'way id');
    store.commands.ways.addWayPoint(road, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(road, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    store.commands.ways.setWayCapacity(road, 4);
  });

  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };

  // Lane fan-out is street-tier-only geometry (see buildFeatures's LOD
  // collapse to one overview silhouette per corridor at a distant camera);
  // the default world-scale test presentation resolves to overview tier and
  // would report one feature regardless of capacity, so these two checks
  // supply a close camera over the road itself.
  const streetPresentation = renderPresentationForViewport({
    center: [-115.15, 36.1],
    zoom: 20,
    width: 1_440,
    height: 900,
  });

  const roadWay = () =>
    mustFind(
      store.getState().system.ways.find((w) => w.id === road),
      'way',
    );

  it('setWayCapacity updates the way', () => {
    expect(wayCapacity(roadWay())).toBe(4);
  });

  it('setWayCapacity clamps to a minimum of 1', () => {
    store.commands.ways.setWayCapacity(road, 0);
    expect(wayCapacity(roadWay())).toBe(1);
  });

  // Street tier replaced the screen-space "offset fan" that used to live in
  // `ways` (one LineString per lane, distinguished by an `offset` property)
  // with real per-lane polygon geometry in the separate `lanes` collection —
  // `ways` now carries only a single selection-halo feature per way at this
  // tier. These two checks follow that relocation: they count/position the
  // capacity-counted ('drive') lane surfaces instead.
  it('infrastructure view fans a 4-lane road into 4 offset features', () => {
    const infra = buildFeatures(store.getState().system, null, [], {
      viewMode: 'infrastructure',
      ...filters,
      presentation: streetPresentation,
    });
    const driveLanes = infra.lanes.features.filter(
      (f) => f.properties?.wayId === road && f.properties.kindId === 'drive',
    );
    expect(driveLanes.length).toBe(4);
  });

  it('each lane gets a distinct offset', () => {
    const infra = buildFeatures(store.getState().system, null, [], {
      viewMode: 'infrastructure',
      ...filters,
      presentation: streetPresentation,
    });
    const driveLanes = infra.lanes.features.filter(
      (f) => f.properties?.wayId === road && f.properties.kindId === 'drive',
    );
    // No `offset` property exists on real lane geometry; distinct lateral
    // position (perpendicular to this east-west road, i.e. distinct latitude)
    // is the surviving equivalent of "each lane rendered somewhere different".
    const lateralPositions = new Set(
      driveLanes.map((f) => {
        const ring = (f.geometry as { coordinates: number[][][] }).coordinates[0];
        const centroidLat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
        return Math.round(centroidLat * 1e6);
      }),
    );
    expect(lateralPositions.size).toBe(4);
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
    store.commands.services.addServiceToWay(road);
    const netServed = buildFeatures(store.getState().system, null, [], {
      viewMode: 'network',
      ...filters,
    });
    expect(netServed.ways.features.filter((f) => f.properties?.id === road).length).toBe(0);
  });

  it('network view renders the service itself regardless of capacity', () => {
    const svc = mustFind(store.commands.services.addServiceToWay(road), 'service');
    const netServed = buildFeatures(store.getState().system, null, [], {
      viewMode: 'network',
      ...filters,
    });
    expect(netServed.services.features.some((f) => f.properties?.serviceId === svc)).toBe(true);
  });
});

describe('a station footprint can be added, reshaped, and given platforms', () => {
  let store: ReturnType<typeof createEditorStore>;
  let stId: string;

  beforeEach(() => {
    store = createEditorStore();
    // A Station has no "create empty" command — addDrawnStation always seeds
    // a footprint — so an empty station here is reached by drawing one and
    // then deleting its footprint.
    stId = mustFind(
      store.commands.stations.addDrawnStation(squareFootprint([-115.15, 36.1], 30)),
      'station id',
    );
    store.commands.stations.deleteStationFootprint(stId);
  });

  const withFootprint = () =>
    mustFind(
      store.getState().system.stations.find((s) => s.id === stId),
      'station',
    );

  it('station starts with no footprint', () => {
    expect(store.getState().system.stations[0].footprint).toBeUndefined();
  });

  it('addStationFootprint gives it a 4-corner default square', () => {
    store.commands.stations.addStationFootprint(stId);
    expect(withFootprint().footprint?.length).toBe(4);
  });

  it('squareFootprint is centered on its input coord', () => {
    const square = squareFootprint([-115.15, 36.1], 30);
    expect(Math.abs((square[0][0] + square[2][0]) / 2 - -115.15)).toBeLessThan(1e-9);
  });

  it('moveFootprintPoint edits one corner', () => {
    store.commands.stations.addStationFootprint(stId);
    store.commands.stations.moveFootprintPoint(stId, 0, [-115.1501, 36.1001]);
    expect(mustFind(withFootprint().footprint, 'footprint')[0][0]).toBe(-115.1501);
  });

  it('addPlatform adds a platform to the station', () => {
    store.commands.stations.addStationFootprint(stId);
    const platformId = store.commands.stations.addPlatform(stId);
    expect(withFootprint().platforms?.length).toBe(1);
    expect(mustFind(withFootprint().platforms, 'platforms')[0].id).toBe(platformId);
  });

  it('movePlatformPoint edits one platform corner', () => {
    store.commands.stations.addStationFootprint(stId);
    const platformId = mustFind(store.commands.stations.addPlatform(stId), 'platform id');
    store.commands.stations.movePlatformPoint(stId, platformId, 1, [-115.14, 36.09]);
    expect(mustFind(withFootprint().platforms, 'platforms')[0].points[1][0]).toBe(-115.14);
  });

  it('deletePlatform removes it', () => {
    store.commands.stations.addStationFootprint(stId);
    const platformId = mustFind(store.commands.stations.addPlatform(stId), 'platform id');
    store.commands.stations.deletePlatform(stId, platformId);
    expect(withFootprint().platforms?.length).toBe(0);
  });

  it('deleteStationFootprint clears the footprint (and any platforms)', () => {
    store.commands.stations.addStationFootprint(stId);
    store.commands.stations.addPlatform(stId);
    store.commands.stations.deleteStationFootprint(stId);
    expect(withFootprint().footprint).toBeUndefined();
  });
});

describe('facilities are placed, moved, renamed, and removed as catalog-typed points', () => {
  let store: ReturnType<typeof createEditorStore>;
  let facId: string;

  beforeEach(() => {
    store = createEditorStore();
    facId = mustFind(
      store.commands.facilities.addFacility('bikeDock', [-115.16, 36.12]),
      'facility id',
    );
  });

  it('addFacility creates it and selects it', () => {
    expect(store.getState().system.facilities.length).toBe(1);
    expect(store.getState().selection?.kind).toBe('facility');
  });

  it('facility keeps its catalog type', () => {
    expect(store.getState().system.facilities[0].typeId).toBe('bikeDock');
  });

  it('moveFacility updates its geometry', () => {
    store.commands.facilities.moveFacility(facId, [-115.161, 36.121]);
    expect((store.getState().system.facilities[0].geometry as [number, number])[0]).toBe(-115.161);
  });

  it('setFacilityName renames it', () => {
    store.commands.facilities.setFacilityName(facId, 'Main entrance dock');
    expect(store.getState().system.facilities[0].name).toBe('Main entrance dock');
  });

  it('deleteFacility removes it and clears the selection', () => {
    store.commands.facilities.deleteFacility(facId);
    expect(store.getState().system.facilities.length).toBe(0);
    expect(store.getState().selection).toBeNull();
  });
});

describe('grouping bundles stops into complexes and keeps membership consistent as it changes', () => {
  let store: ReturnType<typeof createEditorStore>;
  let a: string;
  let b: string;
  let c: string;
  let groupId: string;

  beforeEach(() => {
    store = createEditorStore();
    a = mustFind(store.commands.stops.addStop([-115.2, 36.1]), 'stop id');
    b = mustFind(store.commands.stops.addStop([-115.2001, 36.1001]), 'stop id');
    c = mustFind(store.commands.stops.addStop([-115.2002, 36.1002]), 'stop id');
    groupId = mustFind(store.commands.groups.createGroup([a, b], 'Downtown complex'), 'group id');
  });

  it('createGroup bundles the given members', () => {
    expect(store.getState().system.groups[0].memberIds.length).toBe(2);
  });

  it('addGroupMember adds a third member', () => {
    store.commands.groups.addGroupMember(groupId, c);
    expect(store.getState().system.groups[0].memberIds).toContain(c);
  });

  it('addGroupMember is idempotent (no duplicate)', () => {
    store.commands.groups.addGroupMember(groupId, c);
    store.commands.groups.addGroupMember(groupId, c);
    expect(store.getState().system.groups[0].memberIds.filter((m) => m === c).length).toBe(1);
  });

  it('removeGroupMember removes just that member', () => {
    store.commands.groups.removeGroupMember(groupId, b);
    expect(store.getState().system.groups[0].memberIds).not.toContain(b);
    expect(store.getState().system.groups[0].memberIds).toContain(a);
  });

  it('renameGroup renames it', () => {
    store.commands.groups.renameGroup(groupId, 'Renamed complex');
    expect(store.getState().system.groups[0].name).toBe('Renamed complex');
  });

  it('deleteGroup removes it', () => {
    store.commands.groups.deleteGroup(groupId);
    expect(store.getState().system.groups.length).toBe(0);
  });
});
