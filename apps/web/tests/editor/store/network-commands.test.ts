import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem, Way } from '@transitmapper/core/model/system';
import { describe, expect, it, vi } from 'vitest';
import { createNetworkCommands } from '../../../src/editor/store/commands/network-commands';
import { createEditorRuntime } from '../../../src/editor/store/runtime';

function road(id: string, points: Way['points']): Way {
  return {
    id,
    typeId: 'road',
    points,
    geometry: 'straight',
    grade: 'atGrade',
    classId: 'local',
    profile: defaultProfileFor('road'),
  };
}

function networkSystem(): TransitSystem {
  const first = road('first', [
    [-115.2, 36.1],
    [-115.1, 36.1],
  ]);
  const second = road('second', [
    [-115.1, 36.1],
    [-115, 36.1],
  ]);
  return {
    ...createEmptySystem(),
    ways: [first, second],
    nodes: [
      {
        id: 'junction',
        coord: [-115.1, 36.1],
        refs: [
          { wayId: first.id, pointIndex: 1 },
          { wayId: second.id, pointIndex: 0 },
        ],
      },
    ],
    namedWays: [{ id: 'street', name: 'Main Street', wayIds: [first.id, second.id] }],
  };
}

describe('network commands', () => {
  it('blocks every network content command in read-only documents', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = createEditorRuntime();
    const system = networkSystem();
    runtime.installDocument(system, { tool: 'select', readOnly: true });
    const createId = vi.fn(() => 'forbidden');
    const commands = createNetworkCommands(runtime, { createId });

    commands.setNodeControl('junction', 'signal');
    commands.setNodeConnectors('junction', []);
    commands.disconnectNodeWay('junction', 'first');
    commands.setApproachControl('first', 'end', 'stop');
    commands.setTurnRestriction('first', system.ways[0].profile.lanes[0].id, []);
    commands.setDrivingSide('left');
    commands.formCrossingJunctions('first');
    commands.mergeWays('first', 'second');
    expect(commands.separateCarriageways('first')).toBeNull();
    commands.combineCarriageways('street');
    commands.setMedianWidth('street', 8);
    expect(commands.deleteWayStretch('first', 0.25, 0.75)).toBe(0);
    expect(commands.mergeWaysIntoCorridor(['first', 'second'])).toBe(0);

    expect(runtime.read().system).toBe(system);
    expect(runtime.read().canUndo).toBe(false);
    expect(createId).not.toHaveBeenCalled();
  });

  it('blocks returned loading commands before generating ids', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const system = networkSystem();
    const runtime = createEditorRuntime({ documentStatus: 'loading', initialSystem: system });
    const createId = vi.fn(() => 'forbidden');
    const commands = createNetworkCommands(runtime, { createId });

    expect(commands.separateCarriageways('first')).toBeNull();
    expect(commands.deleteWayStretch('first', 0.25, 0.75)).toBe(0);
    expect(commands.mergeWaysIntoCorridor(['first', 'second'])).toBe(0);
    expect(runtime.read().system).toBe(system);
    expect(createId).not.toHaveBeenCalled();
  });

  it('separates carriageways in one write and one undo snapshot', () => {
    const runtime = createEditorRuntime();
    const system = networkSystem();
    runtime.installDocument(system, { tool: 'select' });
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('backward')
      .mockReturnValueOnce('new-street');
    const commands = createNetworkCommands(runtime, { createId });
    let systemWrites = 0;
    runtime.subscribe((next, previous) => {
      if (next.system !== previous.system) systemWrites++;
    });

    expect(commands.separateCarriageways('first')).toBe('backward');
    expect(systemWrites).toBe(1);
    expect(runtime.read().system.ways.some((way) => way.id === 'backward')).toBe(true);

    runtime.history.undo();
    expect(runtime.read().system).toBe(system);
    expect(runtime.read().canUndo).toBe(false);
  });

  it('does not create history for equal network values', () => {
    const runtime = createEditorRuntime();
    const system = networkSystem();
    runtime.installDocument(system, { tool: 'select' });
    const commands = createNetworkCommands(runtime);

    commands.setDrivingSide(system.drivingSide);
    commands.setNodeControl('missing', 'signal');
    commands.setMedianWidth('missing', undefined);

    expect(runtime.read().system).toBe(system);
    expect(runtime.read().canUndo).toBe(false);
  });
});
