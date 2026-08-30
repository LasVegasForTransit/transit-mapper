import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import {
  appendGtfsImportBatch,
  createGtfsImportDraft,
  materializeGtfsImportDraft,
} from '@transitmapper/core/model/gtfs-import-staging';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImportCommands } from '../../../src/editor/store/commands/import-commands';
import { createEditorRuntime } from '../../../src/editor/store/runtime';

afterEach(() => {
  vi.restoreAllMocks();
});

function createCommands() {
  const runtime = createEditorRuntime();
  const commands = createImportCommands(runtime);
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

  it('accepts a completed GTFS candidate only while its exact source snapshot is current', () => {
    const { runtime, commands } = createCommands();
    const expectedSystem = createEmptySystem();
    const reconciled = { ...expectedSystem, name: 'Reconciled' };
    runtime.installDocument(expectedSystem, { tool: 'select' });

    expect(
      commands.applyCompletedGtfsImport({
        targetSystemId: expectedSystem.id,
        expectedSystem,
        result: { system: reconciled, reconciled: 1 },
      }),
    ).toBe(true);
    expect(runtime.read().system.name).toBe('Reconciled');

    const current = runtime.read().system;
    expect(
      commands.applyCompletedGtfsImport({
        targetSystemId: expectedSystem.id,
        expectedSystem,
        result: { system: { ...reconciled, name: 'Stale' }, reconciled: 1 },
      }),
    ).toBe(false);
    expect(runtime.read().system).toBe(current);
  });

  it('accepts an unchanged completed candidate without replacing content or history', () => {
    const { runtime, commands } = createCommands();
    const expectedSystem = createEmptySystem();
    runtime.installDocument(expectedSystem, { tool: 'select' });

    expect(
      commands.applyCompletedGtfsImport({
        targetSystemId: expectedSystem.id,
        expectedSystem,
        result: { system: expectedSystem, reconciled: 0 },
      }),
    ).toBe(true);
    expect(runtime.read().system).toBe(expectedSystem);
    expect(runtime.read().canUndo).toBe(false);
  });

  it('blocks every import result while a document is loading', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const system = createEmptySystem();
    const runtime = createEditorRuntime({ documentStatus: 'loading', initialSystem: system });
    const commands = createImportCommands(runtime);
    const network = {
      ways: [],
      nodes: [],
      namedWays: [],
      medians: [],
      turnRestrictions: [],
    };

    expect(commands.importWays(network)).toEqual({ added: 0, skipped: 0 });
    expect(commands.applyImportedNetwork({ targetSystemId: system.id, network })).toBeNull();
    expect(
      commands.applyCompletedGtfsImport({
        targetSystemId: system.id,
        expectedSystem: system,
        result: { system: { ...system }, reconciled: 0 },
      }),
    ).toBe(false);
    expect(commands.reconcileImportedServices([])).toBe(0);
    expect(
      commands.applyCompletedGtfsImport({
        targetSystemId: system.id,
        expectedSystem: system,
        result: { system: { ...system, name: 'Blocked' }, reconciled: 1 },
      }),
    ).toBe(false);
    expect(runtime.read().system).toBe(system);
  });

  it('commits a completed GTFS candidate and its crossings as one history entry', () => {
    const runtime = createEditorRuntime();
    const system = createEmptySystem();
    system.ways = [
      {
        id: 'existing-way',
        typeId: 'road',
        geometry: 'straight',
        grade: 'atGrade',
        profile: defaultProfileFor('road'),
        points: [
          [-115.15, 36.05],
          [-115.15, 36.15],
        ],
      },
    ];
    runtime.installDocument(system, { tool: 'select' });
    const commands = createImportCommands(runtime);
    let systemWrites = 0;
    runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    const candidate = materializeGtfsImportDraft(
      system,
      appendGtfsImportBatch(createGtfsImportDraft(), {
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
        stops: [],
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
      }),
    );

    expect(
      commands.applyCompletedGtfsImport({
        targetSystemId: system.id,
        expectedSystem: system,
        result: { system: candidate, reconciled: 0 },
      }),
    ).toBe(true);

    expect(runtime.read().system.nodes).toHaveLength(1);
    const refWayIds = runtime.read().system.nodes[0]?.refs.map((ref) => ref.wayId) ?? [];
    expect(refWayIds).toContain('existing-way');
    expect(refWayIds).toContain('way');
    expect(runtime.read().system.lines[0]?.serviceIds).toEqual(['service']);
    expect(runtime.read().system.services[0]?.path.id).toBe('service');
    expect(systemWrites).toBe(1);
    runtime.history.undo();
    expect(runtime.read().system).toBe(system);
  });
});
