// Converted from apps/web/tests/verify.test.ts lines 1660-1958 (5 sections).
// Split from facilityGroups.test.ts's complex/group-editing sections to stay
// under max-lines.
import { beforeEach, describe, expect, it } from 'vitest';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { MODES } from '@transitmapper/core/model/catalog';
import { squareFootprint } from '@transitmapper/core/model/geo';
import { createEditorStore } from '../../src/editor/store';
import { buildPhysicalHandles } from '@transitmapper/core/render/buildFeatures';
import { mustFind, required } from '../support/required.test';
import { buildFeatures } from '../support/testRenderPresentation.test';

describe('On-map labels: name flows into station/facility feature properties', () => {
  let store: ReturnType<typeof createEditorStore>;
  let namedId: string;
  let unnamedId: string;
  let facId: string;
  let unnamedFacId: string;

  beforeEach(() => {
    store = createEditorStore();
    namedId = required(store.commands.stops.addStop([-115.16, 36.12]));
    store.commands.stops.setStopName(namedId, 'Downtown');
    unnamedId = required(store.commands.stops.addStop([-115.17, 36.13]));
    facId = required(store.commands.facilities.addFacility('depot', [-115.18, 36.14]));
    store.commands.facilities.setFacilityName(facId, 'Maintenance Yard');
    unnamedFacId = required(store.commands.facilities.addFacility('entrance', [-115.19, 36.15]));
  });

  const view = {
    viewMode: 'network' as const,
    visibleModes: new Set(Object.keys(MODES)),
    visibleWayTypes: new Set<string>(),
  };
  const infraView = { ...view, viewMode: 'infrastructure' as const };
  // Density can deliberately omit a nearby anonymous marker (covered
  // separately); these checks are about serialized names, not density.
  const noDensity = { applyScreenDensity: false };

  it("a named station's feature carries its name (network view too)", () => {
    const net = buildFeatures(store.getState().system, null, [], view, null, null, noDensity);
    const namedStationFeature = net.stops.features.find((f) => f.properties?.id === namedId);
    expect(namedStationFeature?.properties?.name).toBe('Downtown');
  });

  it("an unnamed station's feature has an empty-string name, not undefined", () => {
    const net = buildFeatures(store.getState().system, null, [], view, null, null, noDensity);
    const unnamedStationFeature = net.stops.features.find((f) => f.properties?.id === unnamedId);
    expect(unnamedStationFeature?.properties?.name).toBe('');
  });

  it("a named facility's feature carries its name", () => {
    const infra = buildFeatures(
      store.getState().system,
      null,
      [],
      infraView,
      null,
      null,
      noDensity,
    );
    const namedFacFeature = infra.facilities.features.find((f) => f.properties?.id === facId);
    expect(namedFacFeature?.properties?.name).toBe('Maintenance Yard');
  });

  it("an unnamed facility's feature has an empty-string name, not undefined", () => {
    const infra = buildFeatures(
      store.getState().system,
      null,
      [],
      infraView,
      null,
      null,
      noDensity,
    );
    const unnamedFacFeature = infra.facilities.features.find(
      (f) => f.properties?.id === unnamedFacId,
    );
    expect(unnamedFacFeature?.properties?.name).toBe('');
  });
});

describe('P3: footprints/platforms/facilities render in Infrastructure view only', () => {
  let store: ReturnType<typeof createEditorStore>;
  let stId: string;
  // Empty way-type filter on purpose — footprints/platforms/facilities render
  // independent of way-type visibility, only gated by view mode.
  const emptyView = {
    visibleModes: new Set(Object.keys(MODES)),
    visibleWayTypes: new Set<string>(),
  };
  const infraView = { viewMode: 'infrastructure' as const, ...emptyView };
  const netView = { viewMode: 'network' as const, ...emptyView };

  beforeEach(() => {
    store = createEditorStore();
    stId = required(store.commands.stations.addDrawnStation(squareFootprint([-115.15, 36.1], 30)));
    store.commands.stations.addPlatform(stId);
    store.commands.facilities.addFacility('entrance', [-115.151, 36.101]);
  });

  it('infrastructure view renders the footprint polygon', () => {
    const infra = buildFeatures(store.getState().system, null, [], infraView, stId);
    expect(infra.footprints.features.length).toBe(1);
  });

  it('infrastructure view renders the platform polygon', () => {
    const infra = buildFeatures(store.getState().system, null, [], infraView, stId);
    expect(infra.platforms.features.length).toBe(1);
  });

  it('infrastructure view renders the facility point', () => {
    const infra = buildFeatures(store.getState().system, null, [], infraView, stId);
    expect(infra.facilities.features.length).toBe(1);
  });

  it("physicalHandleStationId renders that station's footprint+platform vertices", () => {
    const infra = buildFeatures(store.getState().system, null, [], infraView, stId);
    expect(infra.physicalHandles.features.length).toBe(4 + 4);
  });

  it('network view hides footprints', () => {
    const net = buildFeatures(store.getState().system, null, [], netView, stId);
    expect(net.footprints.features.length).toBe(0);
  });

  it('network view hides platforms', () => {
    const net = buildFeatures(store.getState().system, null, [], netView, stId);
    expect(net.platforms.features.length).toBe(0);
  });

  it('network view hides facilities', () => {
    const net = buildFeatures(store.getState().system, null, [], netView, stId);
    expect(net.facilities.features.length).toBe(0);
  });

  it('network view hides physical handles too', () => {
    const net = buildFeatures(store.getState().system, null, [], netView, stId);
    expect(net.physicalHandles.features.length).toBe(0);
  });

  it("infrastructure view renders a group's footprint polygon too", () => {
    const groupId = required(
      store.commands.groups.createFacilityComplex([
        [-115.2, 36.13],
        [-115.18, 36.13],
        [-115.18, 36.15],
        [-115.2, 36.15],
      ]),
    );
    const infraWithGroup = buildFeatures(
      store.getState().system,
      null,
      [],
      infraView,
      null,
      groupId,
    );
    // station's + group's
    expect(infraWithGroup.footprints.features.length).toBe(2);
  });

  it("physicalHandleGroupId renders that group's footprint vertices", () => {
    const groupId = required(
      store.commands.groups.createFacilityComplex([
        [-115.2, 36.13],
        [-115.18, 36.13],
        [-115.18, 36.15],
        [-115.2, 36.15],
      ]),
    );
    const infraWithGroup = buildFeatures(
      store.getState().system,
      null,
      [],
      infraView,
      null,
      groupId,
    );
    expect(infraWithGroup.physicalHandles.features.length).toBe(4);
  });

  it("a group's footprint still renders when it isn't the active handle owner", () => {
    store.commands.groups.createFacilityComplex([
      [-115.2, 36.13],
      [-115.18, 36.13],
      [-115.18, 36.15],
      [-115.2, 36.15],
    ]);
    const infraGroupUnselected = buildFeatures(
      store.getState().system,
      null,
      [],
      infraView,
      null,
      null,
    );
    expect(infraGroupUnselected.footprints.features.length).toBe(2);
  });

  it("but its handles don't, without physicalHandleGroupId", () => {
    store.commands.groups.createFacilityComplex([
      [-115.2, 36.13],
      [-115.18, 36.13],
      [-115.18, 36.15],
      [-115.2, 36.15],
    ]);
    const infraGroupUnselected = buildFeatures(
      store.getState().system,
      null,
      [],
      infraView,
      null,
      null,
    );
    expect(infraGroupUnselected.physicalHandles.features.length).toBe(0);
  });

  // Same contract as buildHandles: the selection fast path calls this builder
  // directly, so it must agree with the full build feature-for-feature —
  // including emission ORDER, since a reordered collection is a needless
  // re-upload even when it renders identically.
  describe('buildPhysicalHandles agrees with the full build', () => {
    it('buildPhysicalHandles alone emits exactly what the full build emits for a station', () => {
      const infra = buildFeatures(store.getState().system, null, [], infraView, stId);
      const sysP = store.getState().system;
      expect(
        JSON.stringify(
          buildPhysicalHandles(
            sysP.stations.find((s) => s.id === stId),
            null,
          ),
        ),
      ).toBe(JSON.stringify(infra.physicalHandles.features));
    });

    it('buildPhysicalHandles alone emits exactly what the full build emits for a group', () => {
      const groupId = required(
        store.commands.groups.createFacilityComplex([
          [-115.2, 36.13],
          [-115.18, 36.13],
          [-115.18, 36.15],
          [-115.2, 36.15],
        ]),
      );
      const infraWithGroup = buildFeatures(
        store.getState().system,
        null,
        [],
        infraView,
        null,
        groupId,
      );
      const sysP = store.getState().system;
      expect(
        JSON.stringify(
          buildPhysicalHandles(
            null,
            sysP.groups.find((g) => g.id === groupId),
          ),
        ),
      ).toBe(JSON.stringify(infraWithGroup.physicalHandles.features));
    });

    it('buildPhysicalHandles with nothing selected emits nothing', () => {
      expect(buildPhysicalHandles(null, null).length).toBe(0);
    });
  });
});

describe('P3: v3 serialize round-trips footprints, platforms, facilities, groups', () => {
  let store: ReturnType<typeof createEditorStore>;
  let stId: string;

  beforeEach(() => {
    store = createEditorStore();
    stId = required(store.commands.stations.addDrawnStation(squareFootprint([-115.15, 36.1], 30)));
    store.commands.stations.addPlatform(stId);
    store.commands.facilities.addFacility('depot', [-115.16, 36.11]);
    const other = required(store.commands.stops.addStop([-115.17, 36.12]));
    store.commands.groups.createGroup([stId, other], 'Complex');
  });

  it('parse round-trips a station footprint', () => {
    const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
    expect(round.stations.find((s) => s.id === stId)?.footprint?.length).toBe(4);
  });

  it('parse round-trips platforms', () => {
    const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
    expect(round.stations.find((s) => s.id === stId)?.platforms?.length).toBe(1);
  });

  it('parse round-trips facilities', () => {
    const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
    expect(round.facilities.length).toBe(1);
    expect(round.facilities[0].typeId).toBe('depot');
  });

  it('parse round-trips groups', () => {
    const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
    expect(round.groups.length).toBe(1);
    expect(round.groups[0].memberIds.length).toBe(2);
  });

  // A facility complex's footprint + color used to be silently dropped by
  // parseSystem (never read at all) — real data loss on save/reload.
  it("parse round-trips a facility complex's footprint", () => {
    const complexId = required(
      store.commands.groups.createFacilityComplex([
        [-115.2, 36.13],
        [-115.18, 36.13],
        [-115.18, 36.15],
        [-115.2, 36.15],
      ]),
    );
    const roundComplex = parseSystem(
      JSON.parse(JSON.stringify(store.getState().system)),
    ).groups.find((g) => g.id === complexId);
    expect(roundComplex?.footprint?.length).toBe(4);
  });

  it("parse round-trips a facility complex's color", () => {
    const complexId = required(
      store.commands.groups.createFacilityComplex([
        [-115.2, 36.13],
        [-115.18, 36.13],
        [-115.18, 36.15],
        [-115.2, 36.15],
      ]),
    );
    const roundComplex = parseSystem(
      JSON.parse(JSON.stringify(store.getState().system)),
    ).groups.find((g) => g.id === complexId);
    expect(roundComplex?.color).toBe(
      mustFind(
        store.getState().system.groups.find((g) => g.id === complexId),
        'created complex',
      ).color,
    );
  });
});
