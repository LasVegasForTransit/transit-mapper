import { squareFootprint } from '@transitmapper/core/model/geo';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFacilityCommands } from '../../../src/editor/store/commands/facility-commands';
import { createGroupCommands } from '../../../src/editor/store/commands/group-commands';
import { createStationCommands } from '../../../src/editor/store/commands/station-commands';
import { createStopCommands } from '../../../src/editor/store/commands/stop-commands';
import { createEditorRuntime, type EditorRuntime } from '../../../src/editor/store/runtime';

interface PlaceHarness {
  runtime: EditorRuntime;
  stops: ReturnType<typeof createStopCommands>;
  stations: ReturnType<typeof createStationCommands>;
  facilities: ReturnType<typeof createFacilityCommands>;
  groups: ReturnType<typeof createGroupCommands>;
  readCameraCenter: ReturnType<typeof vi.fn>;
}

function createHarness(options: { system?: TransitSystem; readOnly?: boolean } = {}): PlaceHarness {
  const runtime = createEditorRuntime();
  runtime.installDocument(options.system ?? createEmptySystem(1), {
    tool: 'select',
    readOnly: options.readOnly,
  });
  const readCameraCenter = vi.fn(() => [-115.18, 36.13] as [number, number]);
  return {
    runtime,
    stops: createStopCommands(runtime),
    stations: createStationCommands(runtime),
    facilities: createFacilityCommands(runtime),
    groups: createGroupCommands(runtime, { readCameraCenter }),
    readCameraCenter,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('place command factories', () => {
  it('blocks every id-producing place command before it can create content', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runtime = createEditorRuntime({ documentStatus: 'loading' });
    const stops = createStopCommands(runtime);
    const stations = createStationCommands(runtime);
    const facilities = createFacilityCommands(runtime);
    const groups = createGroupCommands(runtime, { readCameraCenter: () => [-115.18, 36.13] });
    const before = runtime.read().system;

    expect(stops.addStop([-115.2, 36.1])).toBeNull();
    expect(stations.addDrawnStation(squareFootprint([-115.2, 36.1], 20))).toBeNull();
    expect(stations.addPlatform('station')).toBeNull();
    expect(facilities.addFacility('entrance', [-115.2, 36.1])).toBeNull();
    expect(groups.createGroup(['stop'])).toBeNull();
    expect(groups.createFacilityComplex(squareFootprint([-115.2, 36.1], 20))).toBeNull();
    expect(groups.placeFacilityInGroup('group', 'entrance', [-115.2, 36.1])).toBeNull();
    expect(runtime.read().system).toBe(before);
  });

  it('creates a Station independently from boarding Stops', () => {
    const harness = createHarness();
    const footprint = squareFootprint([-115.2, 36.1], 20);

    const stationId = harness.stations.addDrawnStation(footprint);
    const next = harness.runtime.read();

    expect(stationId).not.toBeNull();
    expect(next.system.stations).toEqual([expect.objectContaining({ id: stationId, footprint })]);
    expect(next.system.stops).toEqual([]);
    expect(next.selection).toEqual({ kind: 'station', id: stationId });
  });

  it('deleting a Station preserves and detaches its Stops', () => {
    const system: TransitSystem = {
      ...createEmptySystem(1),
      stations: [{ id: 'central', name: 'Central', coord: [-115.2, 36.1] }],
      stops: [
        {
          id: 'platform',
          coord: [-115.2, 36.1],
          anchors: [],
          stationId: 'central',
        },
      ],
    };
    const harness = createHarness({ system });

    harness.stations.deleteStation('central');

    expect(harness.runtime.read().system.stations).toEqual([]);
    expect(harness.runtime.read().system.stops).toEqual([
      expect.objectContaining({ id: 'platform', stationId: undefined }),
    ]);
  });

  it('blocks place content in read-only documents but allows workflow state', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = createHarness({ readOnly: true });
    const before = harness.runtime.read().system;

    expect(harness.stops.addStop([-115.2, 36.1])).toBeNull();
    expect(harness.facilities.addFacility('entrance', [-115.2, 36.1])).toBeNull();
    expect(harness.groups.createGroup([])).toBeNull();
    harness.groups.startPlacingFacility('group');

    expect(harness.runtime.read().system).toBe(before);
    expect(harness.runtime.read().placingFacilityForGroupId).toBe('group');
    expect(harness.runtime.read().tool).toBe('facility');
  });

  it('preserves the system reference for missing and idempotent edits', () => {
    const system: TransitSystem = {
      ...createEmptySystem(1),
      stops: [{ id: 'stop', coord: [-115.2, 36.1], anchors: [] }],
      facilities: [{ id: 'facility', typeId: 'entrance', geometry: [-115.19, 36.11] }],
      groups: [{ id: 'group', memberIds: ['stop'], name: 'Complex' }],
    };
    const harness = createHarness({ system });

    harness.stops.moveStop('stop', [-115.2, 36.1]);
    harness.facilities.moveFacility('facility', [-115.19, 36.11]);
    harness.groups.addGroupMember('group', 'stop');
    harness.groups.renameGroup('group', 'Complex');
    harness.stops.deleteStop('missing');
    harness.facilities.deleteFacility('missing');
    harness.groups.deleteGroup('missing');

    expect(harness.runtime.read().system).toBe(system);
    expect(harness.runtime.read().canUndo).toBe(false);
  });

  it('replaces every stop anchor during direct movement', () => {
    const system: TransitSystem = {
      ...createEmptySystem(1),
      stops: [
        {
          id: 'stop',
          coord: [-115.2, 36.1],
          anchors: [
            { wayId: 'outbound', t: 0.5 },
            { wayId: 'inbound', t: 0.5 },
          ],
        },
      ],
    };
    const harness = createHarness({ system });

    harness.stops.moveStop('stop', [-115.19, 36.11], { wayId: 'new-way', t: 0.25 });
    const stop = harness.runtime.read().system.stops[0];
    expect(stop.anchors).toEqual([{ wayId: 'new-way', t: 0.25 }]);
    expect(stop).not.toHaveProperty('anchor');

    harness.stops.moveStop('stop', [-115.18, 36.12]);
    expect(harness.runtime.read().system.stops[0].anchors).toEqual([]);
  });

  it('returns null instead of a phantom platform or grouped facility id', () => {
    const harness = createHarness();
    const before = harness.runtime.read().system;

    expect(harness.stations.addPlatform('missing')).toBeNull();
    expect(harness.groups.placeFacilityInGroup('missing', 'entrance', [-115.2, 36.1])).toBeNull();
    expect(harness.runtime.read().system).toBe(before);
  });

  it('removes deleted places from every group membership', () => {
    const system: TransitSystem = {
      ...createEmptySystem(1),
      stops: [{ id: 'stop', coord: [-115.2, 36.1], anchors: [] }],
      facilities: [{ id: 'facility', typeId: 'entrance', geometry: [-115.19, 36.11] }],
      groups: [{ id: 'group', memberIds: ['stop', 'facility'] }],
    };
    const harness = createHarness({ system });

    harness.stops.deleteStop('stop');
    expect(harness.runtime.read().system.groups[0].memberIds).toEqual(['facility']);
    harness.facilities.deleteFacility('facility');
    expect(harness.runtime.read().system.groups[0].memberIds).toEqual([]);
  });

  it('installs a facility on Station land and its complex in one content write', () => {
    const system: TransitSystem = {
      ...createEmptySystem(1),
      stations: [
        {
          id: 'station',
          name: 'Bonneville Transit Center',
          coord: [-115.15, 36.1],
          footprint: squareFootprint([-115.15, 36.1], 30),
        },
      ],
    };
    const harness = createHarness({ system });
    let systemWrites = 0;
    harness.runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    const facilityId = harness.facilities.addFacility('entrance', [-115.15, 36.1]);
    const next = harness.runtime.read().system;

    expect(facilityId).not.toBeNull();
    expect(next.groups).toHaveLength(1);
    expect(next.groups[0].name).toBe('Bonneville Transit Center complex');
    expect(next.groups[0].memberIds).toEqual(['station', facilityId]);
    expect(systemWrites).toBe(1);
  });

  it('reads the live camera only when adding a missing group footprint', () => {
    const system: TransitSystem = {
      ...createEmptySystem(1),
      groups: [{ id: 'group', memberIds: [] }],
    };
    const harness = createHarness({ system });

    harness.groups.addGroupFootprint('missing');
    expect(harness.readCameraCenter).not.toHaveBeenCalled();
    expect(harness.runtime.read().system).toBe(system);

    harness.groups.addGroupFootprint('group');
    expect(harness.readCameraCenter).toHaveBeenCalledOnce();
    expect(harness.runtime.read().system.groups[0].footprint).toHaveLength(4);
  });

  it('applies a stop-name suggestion in one undoable content write', () => {
    const system: TransitSystem = {
      ...createEmptySystem(1),
      ways: [
        {
          id: 'home',
          typeId: 'road',
          geometry: 'straight',
          grade: 'atGrade',
          profile: defaultProfileFor('road'),
          points: [
            [-115.2, 36.1],
            [-115.15, 36.1],
            [-115.1, 36.1],
          ],
        },
        {
          id: 'cross',
          typeId: 'road',
          geometry: 'straight',
          grade: 'atGrade',
          profile: defaultProfileFor('road'),
          points: [
            [-115.15, 36.05],
            [-115.15, 36.1],
            [-115.15, 36.15],
          ],
        },
      ],
      namedWays: [
        { id: 'home-name', name: 'Home St', wayIds: ['home'] },
        { id: 'cross-name', name: 'Cross Ave', wayIds: ['cross'] },
      ],
      nodes: [
        {
          id: 'intersection',
          coord: [-115.15, 36.1],
          refs: [
            { wayId: 'home', pointIndex: 1 },
            { wayId: 'cross', pointIndex: 1 },
          ],
        },
      ],
      stops: [
        {
          id: 'stop',
          name: 'Wrong',
          coord: [-115.15, 36.1],
          anchors: [{ wayId: 'home', t: 0.5 }],
        },
      ],
    };
    const harness = createHarness({ system });
    let systemWrites = 0;
    harness.runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    harness.stops.suggestStopName('stop');

    expect(harness.runtime.read().system.stops[0].name).toBe('Home St @ Cross Ave');
    expect(systemWrites).toBe(1);
    harness.runtime.history.undo();
    expect(harness.runtime.read().system).toBe(system);
  });
});
