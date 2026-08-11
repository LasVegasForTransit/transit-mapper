import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { describe, expect, it, vi } from 'vitest';
import { createImportCommands } from '../../../src/editor/store/commands/import-commands';
import { createEditorRuntime } from '../../../src/editor/store/runtime';

function createCommands() {
  const runtime = createEditorRuntime();
  const commands = createImportCommands(runtime, {
    formCrossings: (system) => system,
  });
  return { runtime, commands };
}

describe('import command factories', () => {
  it('accepts fetched ways only while their target document remains active', () => {
    const { runtime, commands } = createCommands();
    const target = createEmptySystem();
    runtime.installDocument(target, { tool: 'select' });
    const network = {
      ways: [
        {
          id: 'street',
          typeId: 'road' as const,
          geometry: 'straight' as const,
          grade: 'atGrade' as const,
          profile: defaultProfileFor('road'),
          points: [[-115.2, 36.1] as [number, number], [-115.1, 36.1] as [number, number]],
        },
      ],
      nodes: [],
      namedWays: [],
      medians: [],
      turnRestrictions: [],
    };

    expect(commands.applyImportedNetwork({ targetSystemId: target.id, network })).toEqual({
      added: 1,
      skipped: 0,
    });
    expect(runtime.read().system.ways.map((way) => way.id)).toEqual(['street']);

    const replacement = createEmptySystem();
    runtime.installDocument(replacement, { tool: 'select' });
    expect(commands.applyImportedNetwork({ targetSystemId: target.id, network })).toBeNull();
    expect(runtime.read().system).toBe(replacement);
  });

  it('accepts reconciliation only while its exact input snapshot is current', () => {
    const { runtime, commands } = createCommands();
    const expectedSystem = createEmptySystem();
    const reconciled = { ...expectedSystem, name: 'Reconciled' };
    runtime.installDocument(expectedSystem, { tool: 'select' });

    expect(
      commands.applyImportedReconciliation({
        expectedSystem,
        result: { system: reconciled, reconciled: 1 },
      }),
    ).toBe(true);
    expect(runtime.read().system.name).toBe('Reconciled');

    const current = runtime.read().system;
    expect(
      commands.applyImportedReconciliation({
        expectedSystem,
        result: { system: { ...reconciled, name: 'Stale' }, reconciled: 1 },
      }),
    ).toBe(false);
    expect(runtime.read().system).toBe(current);
  });

  it('accepts a no-op worker reconciliation without replacing content or history', () => {
    const { runtime, commands } = createCommands();
    const expectedSystem = createEmptySystem();
    runtime.installDocument(expectedSystem, { tool: 'select' });

    expect(
      commands.applyImportedReconciliation({
        expectedSystem,
        result: { system: { ...expectedSystem }, reconciled: 0 },
      }),
    ).toBe(true);
    expect(runtime.read().system).toBe(expectedSystem);
    expect(runtime.read().canUndo).toBe(false);
  });

  it('blocks all import content in a read-only document', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { runtime, commands } = createCommands();
    const system = createEmptySystem();
    runtime.installDocument(system, { tool: 'select', readOnly: true });

    expect(
      commands.applyImportedNetwork({
        targetSystemId: system.id,
        network: {
          ways: [],
          nodes: [],
          namedWays: [],
          medians: [],
          turnRestrictions: [],
        },
      }),
    ).toBeNull();
    expect(
      commands.importWays({
        ways: [],
        nodes: [],
        namedWays: [],
        medians: [],
        turnRestrictions: [],
      }),
    ).toEqual({
      added: 0,
      skipped: 0,
    });
    commands.importGtfs({ ways: [], lines: [], services: [], stations: [] });
    expect(commands.reconcileImportedServices([])).toBe(0);
    expect(
      commands.applyGtfsImportBatch({
        targetSystemId: system.id,
        pieces: { ways: [], lines: [], services: [], stations: [] },
      }),
    ).toBe(false);
    expect(runtime.read().system).toBe(system);
  });

  it('blocks every import result while a document is loading', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const system = createEmptySystem();
    const runtime = createEditorRuntime({ documentStatus: 'loading', initialSystem: system });
    const commands = createImportCommands(runtime, {
      formCrossings: (candidate) => candidate,
    });
    const network = {
      ways: [],
      nodes: [],
      namedWays: [],
      medians: [],
      turnRestrictions: [],
    };

    expect(commands.importWays(network)).toEqual({ added: 0, skipped: 0 });
    expect(commands.applyImportedNetwork({ targetSystemId: system.id, network })).toBeNull();
    commands.importGtfs({ ways: [], lines: [], services: [], stations: [] });
    expect(
      commands.applyGtfsImportBatch({
        targetSystemId: system.id,
        pieces: { ways: [], lines: [], services: [], stations: [] },
      }),
    ).toBe(false);
    expect(commands.reconcileImportedServices([])).toBe(0);
    expect(
      commands.applyImportedReconciliation({
        expectedSystem: system,
        result: { system: { ...system, name: 'Blocked' }, reconciled: 1 },
      }),
    ).toBe(false);
    expect(runtime.read().system).toBe(system);
  });

  it('accepts an empty current-document batch without a history entry', () => {
    const { runtime, commands } = createCommands();
    const system = createEmptySystem();
    runtime.installDocument(system, { tool: 'select' });

    expect(
      commands.applyGtfsImportBatch({
        targetSystemId: system.id,
        pieces: { ways: [], lines: [], services: [], stations: [] },
      }),
    ).toBe(true);
    expect(runtime.read().system).toBe(system);
    expect(runtime.read().canUndo).toBe(false);
  });

  it('commits imported ways and crossing formation as one history entry', () => {
    const runtime = createEditorRuntime();
    const system = createEmptySystem();
    runtime.installDocument(system, { tool: 'select' });
    const commands = createImportCommands(runtime, {
      formCrossings: (candidate, wayId) => ({
        ...candidate,
        nodes: [...candidate.nodes, { id: `crossing-${wayId}`, coord: [-115.15, 36.1], refs: [] }],
      }),
    });
    let systemWrites = 0;
    runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    commands.importGtfs({
      lines: [{ id: 'line', name: 'Line 1', color: '#123456', serviceIds: ['service'] }],
      services: [
        {
          id: 'service',
          modeId: 'bus',
          path: {
            id: 'service',
            sections: [
              {
                kind: 'shared',
                legs: [
                  {
                    wayId: 'way',
                    direction: 'withPoints',
                    extent: { kind: 'whole' },
                    lane: { kind: 'auto' },
                  },
                ],
              },
            ],
          },
        },
      ],
      stations: [],
      ways: [
        {
          id: 'way',
          typeId: 'road',
          geometry: 'straight',
          grade: 'atGrade',
          profile: defaultProfileFor('road'),
          points: [
            [-115.2, 36.1],
            [-115.1, 36.1],
          ],
        },
      ],
    });

    expect(runtime.read().system.nodes[0]?.id).toBe('crossing-way');
    expect(runtime.read().system.lines[0]?.serviceIds).toEqual(['service']);
    expect(runtime.read().system.services[0]?.path.id).toBe('service');
    expect(systemWrites).toBe(1);
    runtime.history.undo();
    expect(runtime.read().system).toBe(system);
  });
});
