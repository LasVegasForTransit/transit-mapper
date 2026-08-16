import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import {
  ALL_SYSTEM_FEATURE_SOURCES,
  createSourceUploadQueue,
  sourceUploadsForSystemChange,
} from '../../src/map/sourceUploadPlan';
import {
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  EDITOR_SYSTEM_FEATURE_SOURCES,
} from '../../src/map/system-feature-sources';
import {
  SRC_CONNECTORS,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_JUNCTIONS,
  SRC_LANE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_LANES,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_SERVICE_ARROWS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAY_LABELS,
  SRC_WAYS,
} from '../../src/map/layers';

describe('map source upload planning', () => {
  it('uploads every derived source for initial, healed-style, and view builds', () => {
    const system = createEmptySystem();
    const nextDocument = { ...system, id: 'another-document' };

    expect(sourceUploadsForSystemChange(null, system)).toEqual(ALL_SYSTEM_FEATURE_SOURCES);
    expect(sourceUploadsForSystemChange(system, system, { forceAll: true })).toEqual(
      ALL_SYSTEM_FEATURE_SOURCES,
    );
    expect(sourceUploadsForSystemChange(system, nextDocument, { forceAll: true })).toEqual(
      ALL_SYSTEM_FEATURE_SOURCES,
    );
    expect(ALL_SYSTEM_FEATURE_SOURCES).toContain('tm-service-termini');
    expect(ALL_SYSTEM_FEATURE_SOURCES).toHaveLength(16);
  });

  it('keeps every viewport-cullable point and footprint source in full presentation refreshes', () => {
    expect(ALL_SYSTEM_FEATURE_SOURCES).toEqual(
      expect.arrayContaining([
        SRC_HANDLES,
        'tm-service-termini',
        SRC_FOOTPRINTS,
        SRC_PLATFORMS,
        SRC_FACILITIES,
        SRC_PHYSICAL_HANDLES,
      ]),
    );
  });

  it('keeps committed and selection-owned source authority disjoint', () => {
    expect(EDITOR_SYSTEM_FEATURE_SOURCES).toEqual([
      SRC_HANDLES,
      'tm-service-termini',
      SRC_PHYSICAL_HANDLES,
    ]);
    expect(
      EDITOR_SYSTEM_FEATURE_SOURCES.every(
        (sourceId) => !COMMITTED_SYSTEM_FEATURE_SOURCES.includes(sourceId),
      ),
    ).toBe(true);
    expect([...COMMITTED_SYSTEM_FEATURE_SOURCES, ...EDITOR_SYSTEM_FEATURE_SOURCES]).toHaveLength(
      ALL_SYSTEM_FEATURE_SOURCES.length,
    );
  });

  it('uploads only physical passenger-place sources for a Station-only change', () => {
    const before = createEmptySystem();
    const after = { ...before, stations: [...before.stations] };

    expect(sourceUploadsForSystemChange(before, after)).toEqual([
      SRC_FOOTPRINTS,
      SRC_PLATFORMS,
      SRC_PHYSICAL_HANDLES,
    ]);
  });

  it('uploads the historical station source only for an anchored Stop change', () => {
    const before = createEmptySystem();
    const after = { ...before, stops: [...before.stops] };

    expect(sourceUploadsForSystemChange(before, after)).toEqual([SRC_STATIONS]);
  });

  it('refreshes route handles when a selected service pattern changes', () => {
    const before = createEmptySystem();
    const after = { ...before, services: [...before.services] };

    expect(sourceUploadsForSystemChange(before, after)).toEqual([
      SRC_WAYS,
      SRC_SERVICES,
      SRC_STATIONS,
      SRC_HANDLES,
      'tm-service-termini',
      SRC_LANE_ARROWS,
      SRC_SERVICE_ARROWS,
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
        groups: [...before.groups],
      }),
    ).toEqual([SRC_FOOTPRINTS, SRC_PHYSICAL_HANDLES]);
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
    expect(sources).toEqual([SRC_FOOTPRINTS, SRC_PLATFORMS, SRC_FACILITIES, SRC_PHYSICAL_HANDLES]);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('covers every dependent collection for way, service, and node topology', () => {
    const before = createEmptySystem();

    expect(sourceUploadsForSystemChange(before, { ...before, ways: [...before.ways] })).toEqual([
      SRC_WAYS,
      SRC_SERVICES,
      SRC_STATIONS,
      SRC_HANDLES,
      'tm-service-termini',
      SRC_LANES,
      SRC_LANE_MARKINGS,
      SRC_LANE_ARROWS,
      SRC_SERVICE_ARROWS,
      SRC_JUNCTIONS,
      SRC_CONNECTORS,
      SRC_WAY_LABELS,
    ]);
    expect(
      sourceUploadsForSystemChange(before, { ...before, services: [...before.services] }),
    ).toEqual([
      SRC_WAYS,
      SRC_SERVICES,
      SRC_STATIONS,
      SRC_HANDLES,
      'tm-service-termini',
      SRC_LANE_ARROWS,
      SRC_SERVICE_ARROWS,
    ]);
    expect(sourceUploadsForSystemChange(before, { ...before, nodes: [...before.nodes] })).toEqual([
      SRC_WAYS,
      SRC_SERVICES,
      SRC_STATIONS,
      SRC_HANDLES,
      'tm-service-termini',
      SRC_LANES,
      SRC_LANE_MARKINGS,
      SRC_LANE_ARROWS,
      SRC_SERVICE_ARROWS,
      SRC_JUNCTIONS,
      SRC_CONNECTORS,
    ]);
  });

  it('conservatively refreshes lane and junction geometry for system traffic rules', () => {
    const before = createEmptySystem();
    const topologySources = [
      SRC_WAYS,
      SRC_SERVICES,
      SRC_LANES,
      SRC_LANE_MARKINGS,
      SRC_LANE_ARROWS,
      SRC_SERVICE_ARROWS,
      SRC_JUNCTIONS,
      SRC_CONNECTORS,
    ];

    expect(
      sourceUploadsForSystemChange(before, {
        ...before,
        drivingSide: before.drivingSide === 'right' ? 'left' : 'right',
      }),
    ).toEqual(topologySources);
    expect(
      sourceUploadsForSystemChange(before, {
        ...before,
        medians: { ...before.medians },
      }),
    ).toEqual(topologySources);
    expect(
      sourceUploadsForSystemChange(before, {
        ...before,
        approachControls: { ...before.approachControls },
      }),
    ).toEqual([SRC_LANES, SRC_LANE_MARKINGS, SRC_LANE_ARROWS, SRC_JUNCTIONS, SRC_CONNECTORS]);
  });

  it('preserves the exact source union queued across an active gesture', () => {
    const before = createEmptySystem();
    const queue = createSourceUploadQueue();

    queue.add(
      sourceUploadsForSystemChange(before, {
        ...before,
        stations: [...before.stations],
      }),
    );
    queue.add(
      sourceUploadsForSystemChange(before, {
        ...before,
        facilities: [...before.facilities],
      }),
    );

    expect(queue.hasPending()).toBe(true);
    expect(queue.take()).toEqual([
      SRC_FOOTPRINTS,
      SRC_PLATFORMS,
      SRC_FACILITIES,
      SRC_PHYSICAL_HANDLES,
    ]);
    expect(queue.hasPending()).toBe(false);
    expect(queue.take()).toEqual([]);
  });

  it('retains the first and latest immutable snapshots across coalesced changes', () => {
    const first = createEmptySystem();
    const second = { ...first, stations: [...first.stations] };
    const third = { ...second, facilities: [...second.facilities] };
    const queue = createSourceUploadQueue();

    queue.add(sourceUploadsForSystemChange(first, second), { previous: first, next: second });
    queue.add(sourceUploadsForSystemChange(second, third), { previous: second, next: third });

    expect(queue.takeBatch()).toEqual({
      sourceIds: [SRC_FOOTPRINTS, SRC_PLATFORMS, SRC_FACILITIES, SRC_PHYSICAL_HANDLES],
      transition: { previous: first, next: third },
    });
  });

  it('drops entity scoping when a coalesced camera or style request has no snapshot', () => {
    const first = createEmptySystem();
    const second = { ...first, stations: [...first.stations] };
    const queue = createSourceUploadQueue();

    queue.add(sourceUploadsForSystemChange(first, second), { previous: first, next: second });
    queue.add([SRC_WAYS]);

    expect(queue.takeBatch()).toEqual({
      sourceIds: [SRC_WAYS, SRC_FOOTPRINTS, SRC_PLATFORMS, SRC_PHYSICAL_HANDLES],
      transition: null,
    });
  });

  it('drops entity scoping when coalesced snapshot transitions are discontinuous', () => {
    const first = createEmptySystem();
    const second = { ...first, stations: [...first.stations] };
    const unrelated = { ...first, name: 'Unrelated snapshot' };
    const last = { ...unrelated, facilities: [...unrelated.facilities] };
    const queue = createSourceUploadQueue();

    queue.add(sourceUploadsForSystemChange(first, second), { previous: first, next: second });
    queue.add(sourceUploadsForSystemChange(unrelated, last), {
      previous: unrelated,
      next: last,
    });

    expect(queue.takeBatch().transition).toBeNull();
  });
});
