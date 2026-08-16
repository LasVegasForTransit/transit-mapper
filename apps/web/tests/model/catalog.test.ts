import { describe, expect, it } from 'vitest';
import {
  FACILITY_TYPE_ORDER,
  FACILITY_TYPES,
  INITIAL_DRAFT,
  MODE_ORDER,
  PROFILE_PRESETS,
  WAY_FAMILIES,
  WAY_TYPE_ORDER,
  WAY_TYPES,
  mode,
  profilePresetsForWayType,
} from '@transitmapper/core/model/catalog';
import { buildProfile, laneCapacity } from '@transitmapper/core/model/profile';

// These invariants are what let placing/importing code read a value straight
// off the catalog instead of carrying its own fallback for a missing one.
describe('the catalog, not the code around it, decides catalog-level facts', () => {
  const areaTypes = FACILITY_TYPE_ORDER.map((id) => FACILITY_TYPES[id]).filter(
    (t) => t.geometryKind === 'area',
  );

  it('there are area facility types to check', () => {
    expect(areaTypes.length).toBeGreaterThan(0);
  });

  it('every area facility type declares the size it is click-placed at', () => {
    expect(
      areaTypes.every((t) => typeof t.defaultHalfExtentM === 'number' && t.defaultHalfExtentM > 0),
    ).toBe(true);
  });

  it('point facility types declare no footprint size, since they have no footprint', () => {
    const pointTypes = FACILITY_TYPE_ORDER.map((id) => FACILITY_TYPES[id]).filter(
      (t) => t.geometryKind === 'point',
    );

    expect(pointTypes.every((t) => t.defaultHalfExtentM === null)).toBe(true);
  });

  // The starting selection must name things that actually exist, and must
  // not silently fall through the catalog accessors' unknown-id tolerance.
  it('the initial draft mode is a real mode', () => {
    expect(MODE_ORDER).toContain(INITIAL_DRAFT.modeId);
  });

  it('the initial draft way type is a real way type', () => {
    expect(WAY_TYPE_ORDER).toContain(INITIAL_DRAFT.wayTypeId);
  });

  it('the initial draft way type is one the initial mode can run on', () => {
    expect(mode(INITIAL_DRAFT.modeId).wayTypeIds).toContain(INITIAL_DRAFT.wayTypeId);
  });

  // importedCapacity is optional by design (unset = "assume nothing, use the
  // type's own profile"), but where set it has to be a usable lane count.
  it('any declared imported capacity is a positive whole number', () => {
    expect(
      WAY_TYPE_ORDER.map((id) => WAY_TYPES[id]).every(
        (t) =>
          t.importedCapacity === undefined ||
          (Number.isInteger(t.importedCapacity) && t.importedCapacity > 0),
      ),
    ).toBe(true);
  });
});

describe('every way type and preset stays internally consistent with what the catalog declares', () => {
  for (const type of Object.values(WAY_TYPES)) {
    it(`way type "${type.id}" has a default profile`, () => {
      expect(type.defaultProfile.length).toBeGreaterThan(0);
    });

    it(`way type "${type.id}"'s default profile only uses its allowed lane kinds`, () => {
      expect(type.defaultProfile.every((l) => type.laneKindIds.includes(l.kindId))).toBe(true);
    });

    it(`way type "${type.id}"'s primary lane kind is allowed`, () => {
      expect(type.laneKindIds).toContain(type.primaryLaneKindId);
    });

    it(`way type "${type.id}"'s default profile capacity matches its defaultCapacity`, () => {
      expect(laneCapacity(buildProfile(type.defaultProfile))).toBe(type.defaultCapacity);
    });

    it(`way family "${type.family}" has an identity noun`, () => {
      expect(WAY_FAMILIES[type.family].identityNoun.length).toBeGreaterThan(0);
    });
  }

  for (const preset of Object.values(PROFILE_PRESETS)) {
    it(`preset "${preset.id}" targets a real way type`, () => {
      expect(WAY_TYPES[preset.wayTypeId]).toBeDefined();
    });

    it(`preset "${preset.id}" only uses lane kinds its way type allows`, () => {
      const type = WAY_TYPES[preset.wayTypeId];

      expect(preset.lanes.every((l) => type.laneKindIds.includes(l.kindId))).toBe(true);
    });
  }

  it('road offers profile presets', () => {
    expect(profilePresetsForWayType('road').length).toBeGreaterThanOrEqual(5);
  });

  it('pedestrian way type exists (pedestrian-only paths are a catalog entry)', () => {
    expect(WAY_TYPES.pedestrian).toBeDefined();
  });

  it('pedestrian default profile is a walking lane, not a special case', () => {
    expect(WAY_TYPES.pedestrian.defaultProfile[0].kindId).toBe('sidewalk');
  });
});
