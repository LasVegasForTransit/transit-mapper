import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { anchorOnWay, type RouteSpan } from '@transitmapper/core/model/routeGraph';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { aPattern, aRoad, aService, aStop } from '@transitmapper/core/testing/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutingCommands } from '../../../src/editor/store/commands/routing-commands';
import { createEditorRuntime } from '../../../src/editor/store/runtime';

afterEach(() => {
  vi.restoreAllMocks();
});

function routableSystem(): TransitSystem {
  const system = createEmptySystem();
  return {
    ...system,
    ways: [
      {
        id: 'main',
        typeId: 'road',
        geometry: 'straight',
        grade: 'atGrade',
        classId: 'local',
        profile: defaultProfileFor('road'),
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
      },
    ],
  };
}

function commandsFor(runtime: ReturnType<typeof createEditorRuntime>, createId = vi.fn()) {
  return createRoutingCommands(runtime, { createId });
}

describe('routing commands', () => {
  it('commits a route draft with one system write and one undo snapshot', () => {
    const runtime = createEditorRuntime();
    const system = routableSystem();
    runtime.installDocument(system, { tool: 'lines' });
    const createId = vi.fn().mockReturnValueOnce('service').mockReturnValueOnce('line');
    const commands = commandsFor(runtime, createId);
    runtime.updateTransient({ draftColor: '#123456' });
    const way = system.ways[0];
    const from = anchorOnWay(way, [-115.18, 36.1]);
    const to = anchorOnWay(way, [-115.12, 36.1]);
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    if (!from || !to) throw new Error('The routable fixture must produce anchors.');

    let systemWrites = 0;
    runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });
    commands.startRouteDraft(from);
    expect(commands.extendRouteDraft(to)).toBe(true);

    expect(commands.commitRouteDraft()).toBe('service');
    expect(runtime.read().routeDraft).toBeNull();
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
    expect(createId).toHaveBeenCalledTimes(2);
    expect(systemWrites).toBe(1);

    runtime.history.undo();
    expect(runtime.read().system).toBe(system);
    expect(runtime.read().canUndo).toBe(false);
  });

  it('uses the first unused exact Line name for a routed service', () => {
    const base = routableSystem();
    const system: TransitSystem = {
      ...base,
      lines: [{ id: 'existing-line', name: 'Line 1', color: '#111111', serviceIds: ['existing'] }],
      services: [
        {
          id: 'existing',
          modeId: 'bus',
          path: { id: 'existing', sections: [] },
        },
      ],
    };
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'lines' });
    const createId = vi.fn().mockReturnValueOnce('service').mockReturnValueOnce('line');
    const commands = commandsFor(runtime, createId);
    const spans: RouteSpan[] = [{ wayId: 'main', fromPoint: 0, toPoint: 1 }];

    expect(commands.createRoutedService(spans)).toBe('service');
    expect(runtime.read().system.lines[1]?.name).toBe('Line 2');
    expect(runtime.read().system.lines[1]?.serviceIds).toEqual(['service']);
  });

  it('blocks content before generating ids while keeping its transient draft', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const system = routableSystem();
    const runtime = createEditorRuntime({ documentStatus: 'loading', initialSystem: system });
    const createId = vi.fn(() => 'forbidden');
    const commands = commandsFor(runtime, createId);
    const from = anchorOnWay(system.ways[0], [-115.18, 36.1]);
    const to = anchorOnWay(system.ways[0], [-115.12, 36.1]);
    if (!from || !to) throw new Error('The routable fixture must produce anchors.');
    commands.startRouteDraft(from);
    expect(commands.extendRouteDraft(to)).toBe(true);

    expect(commands.commitRouteDraft()).toBeNull();
    expect(createId).not.toHaveBeenCalled();
    expect(runtime.read().routeDraft).not.toBeNull();
    expect(runtime.read().system).toBe(system);
    expect(runtime.read().system.services).toHaveLength(0);
  });

  it('allows transient draft controls in a read-only document', () => {
    const runtime = createEditorRuntime();
    runtime.installDocument(routableSystem(), { tool: 'lines', readOnly: true });
    const commands = commandsFor(runtime);
    const anchor = {
      wayId: 'main',
      insertIndex: 1,
      coord: [-115.18, 36.1] as [number, number],
    };

    commands.startRouteDraft(anchor);
    expect(runtime.read().routeDraft?.lastAnchor).toBe(anchor);
    commands.cancelRouteDraft();
    expect(runtime.read().routeDraft).toBeNull();
  });

  it('preserves the system reference when a routed service cannot materialize', () => {
    const runtime = createEditorRuntime();
    const system = routableSystem();
    runtime.installDocument(system, { tool: 'lines' });
    const createId = vi.fn(() => 'unused');
    const commands = commandsFor(runtime, createId);
    const missingWay: RouteSpan[] = [{ wayId: 'missing', fromPoint: 0, toPoint: 1 }];

    expect(commands.createRoutedService(missingWay)).toBeNull();
    expect(runtime.read().system).toBe(system);
    expect(createId).not.toHaveBeenCalled();
    expect(runtime.read().canUndo).toBe(false);
  });

  it('attaches a return path to the Service singular path without adding a Line', () => {
    const south: [number, number] = [-115.2, 36.1];
    const north: [number, number] = [-115.2, 36.2];
    const northeast: [number, number] = [-115.1, 36.2];
    const southeast: [number, number] = [-115.1, 36.1];
    const spine = aRoad('spine', [south, north]);
    const top = aRoad('top', [north, northeast]);
    const side = aRoad('side', [northeast, southeast]);
    const back = aRoad('back', [southeast, north]);
    const service = aService('service', [aPattern('service', [spine], [spine.id])]);
    const line = { id: 'line', name: 'Line 1', color: '#123456', serviceIds: [service.id] };
    const system: TransitSystem = {
      ...createEmptySystem(),
      ways: [spine, top, side, back],
      lines: [line],
      services: [service],
    };
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'lines' });
    const commands = commandsFor(runtime);
    const spans: RouteSpan[] = [
      { wayId: top.id, fromPoint: 0, toPoint: 1 },
      { wayId: side.id, fromPoint: 0, toPoint: 1 },
      { wayId: back.id, fromPoint: 0, toPoint: 1 },
    ];

    expect(commands.startReturnPathDraft(service.id, service.id)).toBe(true);
    expect(commands.attachReturnPath(service.id, service.id, spans)).toBe(true);

    const updated = runtime.read().system.services[0];
    expect(updated.id).toBe(service.id);
    expect(updated.path.id).toBe(service.id);
    expect(updated.path.sections.some((section) => section.kind === 'turnaround')).toBe(true);
    expect(runtime.read().system.lines).toEqual([line]);
    expect(runtime.read().system.services).toHaveLength(1);
  });

  it('adopts existing infrastructure with one content commit and one undo entry', () => {
    const built = aRoad('built', [
      [-115.28, 36.2],
      [-115.12, 36.2],
    ]);
    const sketch = aRoad('sketch', [
      [-115.28, 36.202],
      [-115.12, 36.202],
    ]);
    const service = aService('service', [aPattern('service', [sketch], [sketch.id])]);
    const system: TransitSystem = {
      ...createEmptySystem(),
      ways: [built, sketch],
      lines: [{ id: 'line', name: 'Line 1', color: '#123456', serviceIds: [service.id] }],
      services: [service],
      stops: [aStop('stop', [-115.25, 36.202], { wayId: sketch.id, t: 0.2 })],
    };
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'lines' });
    const commands = commandsFor(runtime);
    let systemWrites = 0;
    runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    expect(commands.adoptExistingInfrastructure(service.id)).toBe(1);
    expect(runtime.read().system.ways.map((way) => way.id)).toEqual(['built']);
    expect(systemWrites).toBe(1);

    runtime.history.undo();
    expect(runtime.read().system).toBe(system);
    expect(runtime.read().canUndo).toBe(false);
  });

  it('keeps invalid infrastructure and return-path operations reference-preserving', () => {
    const runtime = createEditorRuntime();
    const system = routableSystem();
    runtime.installDocument(system, { tool: 'lines' });
    const commands = commandsFor(runtime);

    expect(commands.adoptExistingInfrastructure('missing')).toBe(0);
    expect(commands.startReturnPathDraft('missing', 'missing')).toBe(false);
    expect(commands.attachReturnPath('missing', 'missing', [])).toBe(false);
    expect(runtime.read().system).toBe(system);
    expect(runtime.read().canUndo).toBe(false);
  });
});
