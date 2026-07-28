import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { ALL_SYSTEM_FEATURE_SOURCES, sourceUploadsForSystemChange } from './sourceUploadPlan';
import {
  SRC_CONNECTORS,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAY_LABELS,
} from './layers';

describe('map source upload planning', () => {
  it('uploads every derived source for initial, healed-style, and view builds', () => {
    const system = createEmptySystem();

    expect(sourceUploadsForSystemChange(null, system)).toEqual(ALL_SYSTEM_FEATURE_SOURCES);
    expect(sourceUploadsForSystemChange(system, system, { forceAll: true })).toEqual(
      ALL_SYSTEM_FEATURE_SOURCES,
    );
    expect(ALL_SYSTEM_FEATURE_SOURCES).toHaveLength(15);
  });

  it('uploads only the four station-derived sources for a station-only change', () => {
    const before = createEmptySystem();
    const after = { ...before, stations: [...before.stations] };

    expect(sourceUploadsForSystemChange(before, after)).toEqual([
      SRC_STATIONS,
      SRC_FOOTPRINTS,
      SRC_PLATFORMS,
      SRC_PHYSICAL_HANDLES,
    ]);
  });

  it('keeps facility, named-way, and restriction changes on their dependent sources', () => {
    const before = createEmptySystem();

    expect(
      sourceUploadsForSystemChange(before, {
        ...before,
        facilities: [...before.facilities],
      }),
    ).toEqual([SRC_FACILITIES]);
    expect(
      sourceUploadsForSystemChange(before, {
        ...before,
        namedWays: [...before.namedWays],
      }),
    ).toEqual([SRC_WAY_LABELS]);
    expect(
      sourceUploadsForSystemChange(before, {
        ...before,
        turnRestrictions: { ...before.turnRestrictions },
      }),
    ).toEqual([SRC_SERVICES, SRC_CONNECTORS]);
  });

  it('unions dependent sources once when coalesced fields change together', () => {
    const before = createEmptySystem();
    const after = {
      ...before,
      stations: [...before.stations],
      facilities: [...before.facilities],
    };

    const sources = sourceUploadsForSystemChange(before, after);
    expect(sources).toEqual([
      SRC_STATIONS,
      SRC_FOOTPRINTS,
      SRC_PLATFORMS,
      SRC_FACILITIES,
      SRC_PHYSICAL_HANDLES,
    ]);
    expect(new Set(sources).size).toBe(sources.length);
  });
});
