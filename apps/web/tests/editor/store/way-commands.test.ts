import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { patternWayIds } from '@transitmapper/core/model/geo';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { aPattern, aRoad, aService } from '@transitmapper/core/testing/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWayCommands } from '../../../src/editor/store/commands/way-commands';
import { createEditorRuntime } from '../../../src/editor/store/runtime';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('way command factory', () => {
  it('blocks content and id creation while the document is loading', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runtime = createEditorRuntime({ documentStatus: 'loading' });
    const createId = vi.fn(() => 'forbidden');
    const commands = createWayCommands(runtime, { createId });
    const before = runtime.read().system;

    expect(commands.beginWay('road', 'straight')).toBeNull();
    expect(commands.beginOneWayBranch('missing', 'end')).toBeNull();
    commands.splitWayAt('missing', 1);
    commands.nameWay('missing', 'Ghost Street');

    expect(runtime.read().system).toBe(before);
    expect(createId).not.toHaveBeenCalled();
  });

  it('creates a way and default service in one guarded content write', () => {
    const runtime = createEditorRuntime();
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('way')
      .mockReturnValueOnce('service')
      .mockReturnValueOnce('line');
    const commands = createWayCommands(runtime, { createId });
    let systemWrites = 0;
    runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    const wayId = commands.beginWay('road', 'straight', '#123456');

    expect(wayId).toBe('way');
    expect(runtime.read().system.ways[0]).toMatchObject({ id: 'way', typeId: 'road' });
    expect(runtime.read().system.services[0]).toMatchObject({
      id: 'service',
      path: { id: 'service' },
    });
    expect(runtime.read().system.lines[0]).toEqual({
      id: 'line',
      name: 'Line 1',
      color: '#123456',
      serviceIds: ['service'],
    });
    expect(runtime.read().selection).toEqual({ kind: 'line', id: 'line' });
    expect(runtime.read().activeWayId).toBe('way');
    expect(systemWrites).toBe(1);
  });

  it('rejects an unknown explicit way type before allocating ids', () => {
    const runtime = createEditorRuntime();
    const createId = vi.fn(() => 'forbidden');
    const commands = createWayCommands(runtime, { createId });
    const before = runtime.read().system;

    expect(commands.beginWay('constructor', 'straight')).toBeNull();

    expect(runtime.read().system).toBe(before);
    expect(createId).not.toHaveBeenCalled();
  });

  it('uses the explicit way type class fallback for a classless preset', () => {
    const runtime = createEditorRuntime();
    runtime.updateTransient({
      draftWayTypeId: 'road',
      draftClassId: 'arterial',
      draftPresetId: 'railSingle',
      draftServiceEnabled: false,
    });
    const commands = createWayCommands(runtime, { createId: vi.fn(() => 'rail-way') });

    expect(commands.beginWay('heavyRail')).toBe('rail-way');
    expect(runtime.read().system.ways[0]).toMatchObject({
      id: 'rail-way',
      typeId: 'heavyRail',
      classId: undefined,
    });
  });

  it('finishes adding a Service to a Line with conflation and crossings in one content write', () => {
    const way = aRoad('branch', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const service = aService('parent', []);
    const system: TransitSystem = {
      ...createEmptySystem(1),
      ways: [way],
      lines: [{ id: 'line', name: 'Line 1', color: '#123456', serviceIds: [service.id] }],
      services: [service],
    };
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'way' });
    runtime.updateTransient({
      activeWayId: way.id,
      addingServiceDraft: { lineId: 'line', name: 'Branch', modeId: 'bus' },
      draftSeparate: false,
    });
    const createId = vi.fn(() => 'branch-service');
    const commands = createWayCommands(runtime, { createId });
    let systemWrites = 0;
    runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    commands.finishWay();

    expect(runtime.read().system.services).toHaveLength(2);
    expect(runtime.read().system.services[1]).toMatchObject({
      id: 'branch-service',
      name: 'Branch',
      modeId: 'bus',
      path: { id: 'branch-service' },
    });
    expect(patternWayIds(runtime.read().system.services[1].path)).toEqual([way.id]);
    expect(runtime.read().system.lines).toEqual([
      {
        id: 'line',
        name: 'Line 1',
        color: '#123456',
        serviceIds: ['parent', 'branch-service'],
      },
    ]);
    expect(runtime.read().selection).toEqual({ kind: 'service', id: 'branch-service' });
    expect(runtime.read().activeWayId).toBeNull();
    expect(runtime.read().addingServiceDraft).toBeNull();
    expect(systemWrites).toBe(1);
  });

  it('discards a stub way and its default service in one content write', () => {
    const way = aRoad('stub', [[-115.2, 36.1]]);
    const service = aService('service', [aPattern('pattern', [way], [way.id])]);
    const runtime = createEditorRuntime();
    runtime.installDocument(
      {
        ...createEmptySystem(1),
        ways: [way],
        lines: [{ id: 'line', name: 'Line 1', color: '#123456', serviceIds: [service.id] }],
        services: [service],
      },
      { tool: 'way' },
    );
    runtime.updateTransient({
      activeWayId: way.id,
      selection: { kind: 'service', id: service.id },
    });
    const commands = createWayCommands(runtime);
    let systemWrites = 0;
    runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    commands.finishWay();

    expect(runtime.read().system.ways).toEqual([]);
    expect(runtime.read().system.lines).toEqual([]);
    expect(runtime.read().system.services).toEqual([]);
    expect(runtime.read().selection).toBeNull();
    expect(systemWrites).toBe(1);
  });

  it('applies a profile preset atomically and preserves no-op system identity', () => {
    const road = aRoad('road', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const system = { ...createEmptySystem(1), ways: [road] };
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });
    const commands = createWayCommands(runtime);
    let systemWrites = 0;
    runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    commands.setWayGrade(road.id, road.grade);
    commands.splitWayAt(road.id, 0);
    commands.applyProfilePreset('missing', 'roadArterial4');
    expect(runtime.read().system).toBe(system);
    expect(systemWrites).toBe(0);

    commands.applyProfilePreset(road.id, 'roadArterial4');
    expect(runtime.read().system.ways[0].classId).toBe('arterial');
    expect(runtime.read().system.ways[0].profile.lanes).toHaveLength(6);
    expect(systemWrites).toBe(1);
  });
});
