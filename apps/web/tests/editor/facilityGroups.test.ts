// Converted from apps/web/tests/verify.test.ts lines 1660-1958 (5 sections).
// Split from this file's rendering/serialization sections in
// facilityRenderingAndSerialization.test.ts to stay under max-lines.
import { beforeEach, describe, expect, it } from 'vitest';
import type { LngLat } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';

/** Throw-guard for a lookup this test's own setup guarantees succeeds — turns
 *  a silent `undefined`/`null` into a clear failure at the point of use
 *  instead of a confusing crash further down the assertion. */
function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

describe('Facility complexes: draw-a-boundary-first editor (task 22)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let groupId: string;
  const drawnRing: LngLat[] = [
    [-115.19, 36.12],
    [-115.17, 36.12],
    [-115.17, 36.14],
    [-115.19, 36.14],
  ];

  beforeEach(() => {
    store = createEditorStore();
    groupId = store.getState().createFacilityComplex(drawnRing);
  });

  it('createFacilityComplex creates a footprint-having group and selects it', () => {
    expect(store.getState().system.groups.length).toBe(1);
    expect(store.getState().selection?.kind).toBe('group');
    expect(store.getState().selection?.id).toBe(groupId);
  });

  it("the new complex's footprint is exactly the boundary that was drawn", () => {
    expect(store.getState().system.groups[0].footprint?.length).toBe(4);
  });

  it('the new complex starts with no members', () => {
    expect(store.getState().system.groups[0].memberIds.length).toBe(0);
  });

  it('createFacilityComplex assigns a color from the palette', () => {
    expect(store.getState().system.groups[0].color).toBeTruthy();
  });

  it('moveGroupFootprintPoint edits one corner', () => {
    store.getState().moveGroupFootprintPoint(groupId, 0, [-115.1801, 36.1301]);
    expect(mustFind(store.getState().system.groups[0].footprint, 'group footprint')[0][0]).toBe(
      -115.1801,
    );
  });

  it('startPlacingFacility arms placement and switches to the facility tool', () => {
    store.getState().startPlacingFacility(groupId);
    expect(store.getState().placingFacilityForGroupId).toBe(groupId);
    expect(store.getState().tool).toBe('facility');
  });

  it('placeFacilityInGroup creates the facility', () => {
    store.getState().startPlacingFacility(groupId);
    const facId = store.getState().placeFacilityInGroup(groupId, 'busBay', [-115.179, 36.129]);
    expect(
      store.getState().system.facilities.some((f) => f.id === facId && f.typeId === 'busBay'),
    ).toBe(true);
  });

  it('placeFacilityInGroup joins it to the complex', () => {
    store.getState().startPlacingFacility(groupId);
    const facId = store.getState().placeFacilityInGroup(groupId, 'busBay', [-115.179, 36.129]);
    expect(store.getState().system.groups[0].memberIds).toContain(facId);
  });

  it('placeFacilityInGroup disarms placement and returns to select', () => {
    store.getState().startPlacingFacility(groupId);
    store.getState().placeFacilityInGroup(groupId, 'busBay', [-115.179, 36.129]);
    expect(store.getState().placingFacilityForGroupId).toBeNull();
    expect(store.getState().tool).toBe('select');
  });

  it('placeFacilityInGroup keeps the complex selected (not the new facility)', () => {
    store.getState().startPlacingFacility(groupId);
    store.getState().placeFacilityInGroup(groupId, 'busBay', [-115.179, 36.129]);
    expect(store.getState().selection?.kind).toBe('group');
    expect(store.getState().selection?.id).toBe(groupId);
  });

  it('startPickingMember arms picking', () => {
    store.getState().startPickingMember(groupId);
    expect(store.getState().pickingMemberForGroupId).toBe(groupId);
  });

  it('picking flow (addGroupMember + cancel) adds the existing station and disarms', () => {
    const looseStation = store.getState().addStation([-115.181, 36.131]);
    store.getState().startPickingMember(groupId);
    store.getState().addGroupMember(groupId, looseStation);
    store.getState().cancelPickingMember();
    expect(store.getState().system.groups[0].memberIds).toContain(looseStation);
    expect(store.getState().pickingMemberForGroupId).toBeNull();
  });

  it('deleteGroupFootprint clears the footprint but keeps members', () => {
    store.getState().startPlacingFacility(groupId);
    store.getState().placeFacilityInGroup(groupId, 'busBay', [-115.179, 36.129]);
    const looseStation = store.getState().addStation([-115.181, 36.131]);
    store.getState().startPickingMember(groupId);
    store.getState().addGroupMember(groupId, looseStation);
    store.getState().cancelPickingMember();

    store.getState().deleteGroupFootprint(groupId);
    expect(store.getState().system.groups[0].footprint).toBeUndefined();
    expect(store.getState().system.groups[0].memberIds.length).toBe(2);
  });

  it('addGroupFootprint re-adds a default footprint', () => {
    store.getState().deleteGroupFootprint(groupId);
    store.getState().addGroupFootprint(groupId);
    expect(store.getState().system.groups[0].footprint?.length).toBe(4);
  });
});

describe('Plain (footprint-less) groups still work — a facility complex is an opt-in specialization, not a required shape for every group', () => {
  it('a plain group has no footprint', () => {
    const store = createEditorStore();
    const a = store.getState().addStation([-115.2, 36.1]);
    const b = store.getState().addStation([-115.2001, 36.1001]);
    store.getState().createGroup([a, b], 'Transfer complex');
    expect(store.getState().system.groups[0].footprint).toBeUndefined();
  });
});
