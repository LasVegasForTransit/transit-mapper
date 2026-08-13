import { patternPositionAt } from '@transitmapper/core/model/serviceEdits';
import { planTerminusGesture } from '@transitmapper/core/model/serviceGestures';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceCompositionCommands } from '../../../src/editor/store/commands/service-composition-commands';
import { createServiceGestureCommands } from '../../../src/editor/store/commands/service-gesture-commands';
import { createServicePatternCommands } from '../../../src/editor/store/commands/service-pattern-commands';
import { createEditorRuntime } from '../../../src/editor/store/runtime';

const A: [number, number] = [-115.2, 36.1];
const B: [number, number] = [-115.19, 36.1];
const C: [number, number] = [-115.18, 36.1];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('service pattern command factories', () => {
  it('blocks id-producing pattern edits before creating phantom content', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const road = aRoad('road', [A, C]);
    const pattern = aPattern('pattern', [road], ['road']);
    const system = aSystem({ ways: [road], services: [aService('service', [pattern])] });
    const position = patternPositionAt([road], system.services[0].path, 'outbound', 0, 0.5);
    if (!position) throw new Error('Expected a position on the fixture pattern');

    for (const block of ['loading', 'read-only'] as const) {
      const runtime = createEditorRuntime(
        block === 'loading' ? { documentStatus: 'loading', initialSystem: system } : {},
      );
      if (block === 'read-only')
        runtime.installDocument(system, { tool: 'select', readOnly: true });
      const commands = createServicePatternCommands(runtime);

      expect(commands.divideServiceAt('service', position)).toBeNull();
      expect(commands.splitServiceAt('service', 'service', 'road', 0.5)).toBeNull();
      expect(runtime.read().system).toBe(system);
    }
  });

  it('preserves the system reference for missing and idempotent edits', () => {
    const road = aRoad('road', [A, B]);
    const pattern = aPattern('pattern', [road], ['road']);
    const system = aSystem({ ways: [road], services: [aService('service', [pattern])] });
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });
    const patterns = createServicePatternCommands(runtime);
    const composition = createServiceCompositionCommands(runtime);

    expect(patterns.trimPatternTo('service', 'missing', 'road', 0.5, 'end')).toBe(false);
    patterns.setStopSkipped('service', 'service', 'outbound', 'stop', false);
    patterns.makePatternTwoWay('service', 'service');
    expect(composition.throughRouteInto('service', 'missing')).toBe(false);

    expect(runtime.read().system).toBe(system);
    expect(runtime.read().canUndo).toBe(false);
  });

  it('divides a service with one content write and one undo entry', () => {
    const road = aRoad('road', [A, C]);
    const pattern = aPattern('pattern', [road], ['road']);
    const system = aSystem({ ways: [road], services: [aService('service', [pattern])] });
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });
    const commands = createServicePatternCommands(runtime);
    const position = patternPositionAt([road], system.services[0].path, 'outbound', 0, 0.5);
    if (!position) throw new Error('Expected a position on the fixture pattern');
    let systemWrites = 0;
    runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    const spawned = commands.divideServiceAt('service', position);

    expect(spawned).not.toBeNull();
    expect(runtime.read().system.services).toHaveLength(2);
    expect(runtime.read().selection).toEqual({ kind: 'service', id: spawned });
    expect(runtime.read().activePatternId).toBe(
      runtime.read().system.services.find((service) => service.id === spawned)?.path.id,
    );
    expect(runtime.read().system.lines[0].serviceIds).toContain(spawned);
    expect(systemWrites).toBe(1);
    runtime.history.undo();
    expect(runtime.read().system).toBe(system);
    expect(runtime.read().canUndo).toBe(false);
  });

  it('splits a service into a distinct public line without changing its way', () => {
    const road = aRoad('road', [A, C]);
    const system = aSystem({
      ways: [road],
      services: [aService('service', [aPattern('pattern', [road], ['road'])])],
    });
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });
    const serviceId = createServicePatternCommands(runtime).splitServiceAt(
      'service',
      'service',
      'road',
      0.5,
    );

    expect(serviceId).not.toBeNull();
    expect(runtime.read().system.ways).toBe(system.ways);
    expect(runtime.read().system.services).toHaveLength(2);
    expect(runtime.read().system.services[1].path.id).toBe(serviceId);
    expect(runtime.read().system.lines).toEqual([
      expect.objectContaining({ serviceIds: ['service'] }),
      expect.objectContaining({
        name: `${system.lines[0].name} 2`,
        serviceIds: [serviceId],
      }),
    ]);
    expect(runtime.read().system.lines[1].color).not.toBe(system.lines[0].color);
  });

  it('does not replace the document when a skipped-stop value is unchanged', () => {
    const road = aRoad('road', [A, B]);
    const pattern = {
      ...aPattern('pattern', [road], ['road']),
      skippedStops: { outbound: ['stop'] },
    };
    const system = aSystem({ ways: [road], services: [aService('service', [pattern])] });
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });
    const commands = createServicePatternCommands(runtime);

    commands.setStopSkipped('service', 'service', 'outbound', 'stop', true);

    expect(runtime.read().system).toBe(system);
    expect(runtime.read().canUndo).toBe(false);
  });

  it('commits a terminus extension atomically and clears a refused gesture transiently', () => {
    const trunk = aRoad('trunk', [A, B]);
    const extension = aRoad('extension', [B, C]);
    const pattern = aPattern('pattern', [trunk], ['trunk']);
    const untouched = aService('untouched', [aPattern('untouched', [trunk], ['trunk'])]);
    const system = aSystem({
      ways: [trunk, extension],
      services: [aService('service', [pattern]), untouched],
      nodes: [
        {
          id: 'junction',
          coord: B,
          refs: [
            { wayId: 'trunk', pointIndex: 1 },
            { wayId: 'extension', pointIndex: 0 },
          ],
        },
      ],
    });
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });
    const commands = createServiceGestureCommands(runtime);
    const source = {
      serviceId: 'service',
      patternId: 'service',
      side: 'end' as const,
      purpose: 'extend' as const,
    };
    const target = { kind: 'corridor' as const, wayId: 'extension', coord: C };
    const plan = planTerminusGesture(system, source, target);
    let systemWrites = 0;
    runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    expect(commands.commitTerminusGesture(source, target, plan)).toBe(true);
    expect(systemWrites).toBe(1);
    expect(runtime.read().system.services.find((service) => service.id === untouched.id)).toBe(
      untouched,
    );
    runtime.history.undo();
    expect(runtime.read().system).toBe(system);

    const terminus = patternPositionAt([trunk], system.services[0].path, 'outbound', 0, 1);
    if (!terminus) throw new Error('Expected the fixture terminus');
    runtime.updateTransient({
      armedTerminus: {
        serviceId: 'service',
        patternId: 'service',
        side: 'end',
        position: terminus,
      },
    });
    const refused = planTerminusGesture(system, source, {
      kind: 'corridor',
      wayId: 'missing',
      coord: C,
    });
    expect(commands.commitTerminusGesture(source, target, refused)).toBe(false);
    expect(runtime.read().system).toBe(system);
    expect(runtime.read().armedTerminus).toBeNull();
  });

  it('through-routes services and removes the consumed line membership atomically', () => {
    const west = aRoad('west', [A, B]);
    const east = aRoad('east', [B, C]);
    const source = aService('source', [aPattern('source-path', [west], ['west'])]);
    const target = aService('target', [aPattern('target-path', [east], ['east'])]);
    const system = aSystem({ ways: [west, east], services: [source, target] });
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });
    const targetPosition = patternPositionAt([east], target.path, 'outbound', 0, 0);
    if (!targetPosition) throw new Error('Expected the target fixture position');
    runtime.updateTransient({
      activePatternId: 'target',
      armedTerminus: {
        serviceId: 'target',
        patternId: 'target',
        side: 'start',
        position: targetPosition,
      },
    });
    const commands = createServiceCompositionCommands(runtime);
    let systemWrites = 0;
    runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    expect(commands.throughRouteInto('source', 'target')).toBe(true);

    expect(runtime.read().system.services).toHaveLength(1);
    expect(runtime.read().system.services[0].id).toBe('source');
    expect(runtime.read().system.lines).toEqual([
      expect.objectContaining({ serviceIds: ['source'] }),
    ]);
    expect(runtime.read().selection).toEqual({ kind: 'service', id: 'source' });
    expect(runtime.read().activePatternId).toBe('source');
    expect(runtime.read().armedTerminus).toBeNull();
    expect(systemWrites).toBe(1);
  });
});
