import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import { patternPositionAt } from '@transitmapper/core/model/serviceEdits';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import { describe, expect, it } from 'vitest';
import { createServiceMetadataCommands } from '../../../src/editor/store/commands/service-metadata-commands';
import { createEditorRuntime } from '../../../src/editor/store/runtime';

const A: [number, number] = [-115.2, 36.1];
const B: [number, number] = [-115.19, 36.1];

describe('service metadata command factory', () => {
  it('creates a public line with one singular-path service', () => {
    const road = aRoad('road', [A, B]);
    const system = aSystem({ ways: [road], lines: [], services: [] });
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });

    const serviceId = createServiceMetadataCommands(runtime).addServiceToWay('road');

    expect(serviceId).not.toBeNull();
    expect(runtime.read().system.services).toHaveLength(1);
    expect(runtime.read().system.services[0].path).toMatchObject({
      id: serviceId,
      sections: oneSection([wholeLeg('road')]),
    });
    expect(runtime.read().system.lines).toEqual([
      expect.objectContaining({ name: 'Line 1', serviceIds: [serviceId] }),
    ]);
    expect(runtime.read().selection).toEqual({
      kind: 'line',
      id: runtime.read().system.lines[0].id,
    });
  });

  it('edits line identity separately from service metadata', () => {
    const road = aRoad('road', [A, B]);
    const service = aService('service', [aPattern('pattern', [road], ['road'])]);
    const system = aSystem({ ways: [road], services: [service] });
    const lineId = system.lines[0].id;
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });
    const commands = createServiceMetadataCommands(runtime);

    commands.setLineName(lineId, 'Charleston');
    commands.setLineColor(lineId, '#246bce');
    commands.setServiceName('service', 'Weekday local');
    commands.setServiceMode('service', 'lightRail');
    commands.setServiceFrequency('service', 12);
    commands.setServiceSpan('service', '05:00', '01:00');

    expect(runtime.read().system.lines[0]).toMatchObject({
      name: 'Charleston',
      color: '#246bce',
    });
    expect(runtime.read().system.services[0]).toMatchObject({
      name: 'Weekday local',
      modeId: 'lightRail',
      frequencyMinutes: 12,
      spanStart: '05:00',
      spanEnd: '01:00',
    });
    expect(runtime.read().system.services[0].path.id).toBe('service');
  });

  it('moves a service between lines and removes its emptied source line', () => {
    const road = aRoad('road', [A, B]);
    const source = aService('source', [aPattern('source-path', [road], ['road'])], {
      name: undefined,
    });
    const target = aService('target', [aPattern('target-path', [road], ['road'])]);
    const system = aSystem({
      ways: [road],
      services: [source, target],
      lines: [
        { id: 'source-line', name: 'Source line', color: '#246bce', serviceIds: ['source'] },
        { id: 'target-line', name: 'Target line', color: '#2ea44f', serviceIds: ['target'] },
      ],
    });
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });

    createServiceMetadataCommands(runtime).moveServiceToLine('source', 'target-line');

    expect(runtime.read().system.lines).toEqual([
      expect.objectContaining({ id: 'target-line', serviceIds: ['target', 'source'] }),
    ]);
    expect(runtime.read().system.services.find((service) => service.id === 'source')?.name).toBe(
      'Source line',
    );
  });

  it('keeps a selected source line when moving one of several services', () => {
    const road = aRoad('road', [A, B]);
    const system = aSystem({
      ways: [road],
      services: [
        aService('moving', [aPattern('moving-path', [road], ['road'])]),
        aService('remaining', [aPattern('remaining-path', [road], ['road'])]),
        aService('target', [aPattern('target-path', [road], ['road'])]),
      ],
      lines: [
        {
          id: 'source-line',
          name: 'Source line',
          color: '#246bce',
          serviceIds: ['moving', 'remaining'],
        },
        { id: 'target-line', name: 'Target line', color: '#2ea44f', serviceIds: ['target'] },
      ],
    });
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });
    runtime.updateTransient({ selection: { kind: 'line', id: 'source-line' } });

    createServiceMetadataCommands(runtime).moveServiceToLine('moving', 'target-line');

    expect(runtime.read().selection).toEqual({ kind: 'line', id: 'source-line' });
  });

  it('deletes line-owned services and prunes an empty line after service deletion', () => {
    const road = aRoad('road', [A, B]);
    const system = aSystem({
      ways: [road],
      services: [aService('service', [aPattern('pattern', [road], ['road'])])],
      groups: [{ id: 'group', memberIds: ['service'] }],
    });
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });
    const commands = createServiceMetadataCommands(runtime);
    const lineId = system.lines[0].id;
    const position = patternPositionAt([road], system.services[0].path, 'outbound', 0, 1);
    if (!position) throw new Error('Expected a position on the fixture path');
    runtime.updateTransient({
      selection: { kind: 'line', id: lineId },
      outlineHover: { kind: 'service', id: 'service' },
      multiSelection: [
        { kind: 'line', id: lineId },
        { kind: 'service', id: 'service' },
      ],
      activePatternId: system.services[0].path.id,
      armedTerminus: {
        serviceId: 'service',
        patternId: system.services[0].path.id,
        side: 'end',
        position,
      },
      addingServiceDraft: { lineId, name: 'Branch', modeId: 'bus' },
      routeDraft: {
        modeId: 'bus',
        lastAnchor: { wayId: 'road', insertIndex: 1, coord: B },
        spans: [],
        returnFor: { serviceId: 'service', patternId: system.services[0].path.id },
      },
    });

    commands.deleteService('service');
    expect(runtime.read().system.services).toEqual([]);
    expect(runtime.read().system.lines).toEqual([]);
    expect(runtime.read()).toMatchObject({
      selection: null,
      outlineHover: null,
      multiSelection: [],
      activePatternId: null,
      armedTerminus: null,
      addingServiceDraft: null,
      routeDraft: null,
    });

    runtime.installDocument(system, { tool: 'select' });
    runtime.updateTransient({
      selection: { kind: 'line', id: lineId },
      outlineHover: { kind: 'service', id: 'service' },
      multiSelection: [
        { kind: 'line', id: lineId },
        { kind: 'service', id: 'service' },
      ],
      activePatternId: system.services[0].path.id,
      armedTerminus: {
        serviceId: 'service',
        patternId: system.services[0].path.id,
        side: 'end',
        position,
      },
      addingServiceDraft: { lineId, name: 'Branch', modeId: 'bus' },
    });
    commands.deleteLine(lineId);
    expect(runtime.read().system.services).toEqual([]);
    expect(runtime.read().system.lines).toEqual([]);
    expect(runtime.read().system.groups[0].memberIds).toEqual([]);
    expect(runtime.read().selection).toBeNull();
    expect(runtime.read().outlineHover).toBeNull();
    expect(runtime.read().multiSelection).toEqual([]);
    expect(runtime.read().activePatternId).toBeNull();
    expect(runtime.read().armedTerminus).toBeNull();
    expect(runtime.read().addingServiceDraft).toBeNull();
  });

  it('arms and cancels the next service drawing without changing content', () => {
    const system = aSystem({ services: [aService('service', [])] });
    const runtime = createEditorRuntime();
    runtime.installDocument(system, { tool: 'select' });
    const commands = createServiceMetadataCommands(runtime);

    commands.startAddingServiceToLine(system.lines[0].id, {
      name: '  Construction shuttle  ',
      modeId: 'bus',
    });
    expect(runtime.read().addingServiceDraft).toEqual({
      lineId: system.lines[0].id,
      name: 'Construction shuttle',
      modeId: 'bus',
    });
    expect(runtime.read().tool).toBe('way');
    expect(runtime.read().system).toBe(system);

    commands.cancelAddingService();
    expect(runtime.read().addingServiceDraft).toBeNull();
    expect(runtime.read().system).toBe(system);
  });
});
