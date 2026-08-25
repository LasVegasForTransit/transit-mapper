import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorStore, type EditorState } from '../../../src/editor/store';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the editor store contract', () => {
  it('reads placement camera state through its injected session dependency', () => {
    const readCameraCenter = vi.fn(() => [-73.9857, 40.7484] as [number, number]);
    const store = createEditorStore({ readCameraCenter });
    const groupId = store.commands.groups.createGroup([]);
    if (!groupId) throw new Error('Expected a group.');

    store.commands.groups.addGroupFootprint(groupId);

    expect(readCameraCenter).toHaveBeenCalledOnce();
    expect(store.getState().system.groups[0]?.footprint).toHaveLength(4);
  });

  it('isolates state, commands, and history per editor instance', () => {
    const first = createEditorStore();
    const second = createEditorStore();

    first.commands.document.setName('First');

    expect(first.getState().system.name).toBe('First');
    expect(second.getState().system.name).toBe('Untitled system');
    expect(first.commands).not.toBe(second.commands);
    expect(first.getState().canUndo).toBe(true);
    expect(second.getState().canUndo).toBe(false);
  });

  it('keeps reactive state data-only and exposes stable grouped commands', () => {
    const store = createEditorStore();
    const commands = store.commands;
    const beginWay = commands.ways.beginWay;

    expect(commands.document.setSystem).toBeTypeOf('function');
    expect(commands.ways.beginWay).toBeTypeOf('function');
    expect(commands.services.setServiceName).toBeTypeOf('function');
    commands.tools.setSelectVariant('erase');
    expect(store.commands).toBe(commands);
    expect(store.commands.ways.beginWay).toBe(beginWay);
    expect('setSystem' in store.getState()).toBe(false);
    expect(Object.values(store.getState()).some((value) => typeof value === 'function')).toBe(
      false,
    );
    expect('setState' in store).toBe(false);
  });

  it('preserves state identity for no-ops and reports subscription snapshots in order', () => {
    const store = createEditorStore();
    const initial = store.getState();
    const listener = vi.fn<(state: EditorState, previous: EditorState) => void>();
    const unsubscribe = store.subscribe(listener);

    store.commands.document.setName(initial.system.name);
    expect(store.getState()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();

    store.commands.selection.select({ kind: 'stop', id: 'stop' });
    expect(listener).toHaveBeenCalledOnce();
    const [next, previous] = listener.mock.calls[0];
    expect(previous).toBe(initial);
    expect(next).toBe(store.getState());
    expect(previous.selection).toBeNull();
    expect(next.selection).toEqual({ kind: 'stop', id: 'stop' });
    expect(next.system).toBe(previous.system);
    unsubscribe();
  });

  it('publishes a content change and its history availability in one subscription event', () => {
    const store = createEditorStore();
    const before = store.getState();
    const listener = vi.fn<(state: EditorState, previous: EditorState) => void>();
    store.subscribe(listener);

    store.commands.document.setName('One write');

    expect(listener).toHaveBeenCalledOnce();
    const [next, previous] = listener.mock.calls[0];
    expect(previous).toBe(before);
    expect(previous.system.name).toBe('Untitled system');
    expect(next).toBe(store.getState());
    expect(next.system.name).toBe('One write');
    expect(next.canUndo).toBe(true);
  });

  it('blocks content edits in read-only documents while allowing transient tools', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    store.commands.document.setSystem(system, { readOnly: true });

    expect(store.commands.ways.beginWay('road', 'straight')).toBeNull();
    expect(store.getState().system).toBe(system);

    store.commands.document.setViewport({ center: [-115, 36], zoom: 12 });
    expect(store.getState().system).toBe(system);

    store.commands.tools.setTool('way');
    expect(store.getState().tool).toBe('way');
  });

  it('applies the read-only mutation gate across every content command group', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [
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
    ];
    system.stops = [{ id: 'stop', coord: [-115.15, 36.1], anchors: [] }];
    store.commands.document.setSystem(system, { readOnly: true });
    store.commands.selection.addMultiSelection([{ kind: 'stop', id: 'stop' }]);

    store.commands.document.setName('Blocked');
    store.commands.tools.addPaletteColor('#123456');
    store.commands.selection.deleteMultiSelection();
    expect(store.commands.ways.beginWay('road', 'straight')).toBeNull();
    store.commands.network.setDrivingSide('left');
    store.commands.imports.importGtfs({
      ways: [],
      lines: [],
      stops: [],
      services: [
        {
          id: 'imported',
          modeId: 'bus',
          path: { id: 'imported', sections: [] },
        },
      ],
    });
    expect(
      store.commands.routing.createRoutedService([{ wayId: 'way', fromPoint: 0, toPoint: 1 }]),
    ).toBeNull();
    expect(store.commands.services.addServiceToWay('way')).toBeNull();
    expect(store.commands.stops.addStop([-115.14, 36.1])).toBeNull();
    expect(store.commands.facilities.addFacility('entrance', [-115.14, 36.1])).toBeNull();
    expect(store.commands.groups.createGroup(['stop'])).toBeNull();

    expect(store.getState().system).toBe(system);
    expect(store.getState().multiSelection).toEqual([{ kind: 'stop', id: 'stop' }]);
  });

  it('clears every document-owned workflow when another document is installed', () => {
    const store = createEditorStore();
    const stopId = store.commands.stops.addStop([-115.2, 36.1]);
    const wayId = store.commands.ways.beginWay('road', 'straight');
    expect(stopId).not.toBeNull();
    expect(wayId).not.toBeNull();
    if (!stopId || !wayId) throw new Error('Expected document workflow fixtures');

    store.commands.selection.setOutlineHover({ kind: 'stop', id: stopId });
    store.commands.selection.addMultiSelection([{ kind: 'way', id: wayId }]);

    store.commands.routing.startRouteDraft({
      wayId: 'route-anchor',
      insertIndex: 0,
      coord: [-115.2, 36.1],
    });
    store.commands.groups.startPlacingFacility('complex');
    store.commands.groups.startPickingMember('complex');
    store.commands.services.startAddingServiceToLine('line', {
      name: 'Branch',
      modeId: 'bus',
    });
    store.commands.tools.setDraftSeparate(true);
    store.commands.selection.armTerminus({
      serviceId: 'service',
      patternId: 'pattern',
      side: 'end',
      position: {
        patternId: 'pattern',
        run: 'outbound',
        legIndex: 0,
        wayId: 'route-anchor',
        t: 1,
        distanceMeters: 1,
      },
    });

    store.commands.document.setSystem(createEmptySystem());

    expect(store.getState()).toMatchObject({
      selection: null,
      outlineHover: null,
      activePatternId: null,
      armedTerminus: null,
      multiSelection: [],
      activeWayId: null,
      draftSeparate: false,
      routeDraft: null,
      placingFacilityForGroupId: null,
      pickingMemberForGroupId: null,
      addingServiceDraft: null,
      focusNameStopId: null,
      canUndo: false,
      canRedo: false,
    });
  });

  it('replaces direct-move stop anchors instead of writing a dead anchor field', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.stops = [
      {
        id: 'stop',
        coord: [-115.2, 36.1],
        anchors: [
          { wayId: 'old-a', t: 0.2 },
          { wayId: 'old-b', t: 0.8 },
        ],
      },
    ];
    store.commands.document.setSystem(system);

    store.commands.stops.moveStop('stop', [-115.1, 36.2], {
      wayId: 'new',
      t: 0.5,
    });
    const anchored = store.getState().system.stops[0];
    expect(anchored.anchors).toEqual([{ wayId: 'new', t: 0.5 }]);
    expect('anchor' in anchored).toBe(false);

    store.commands.stops.moveStop('stop', [-115, 36.3]);
    expect(store.getState().system.stops[0].anchors).toEqual([]);
  });

  it('derives the first unused default line name from the active document', () => {
    const store = createEditorStore();
    store.commands.ways.beginWay('road', 'straight');
    expect(store.getState().system.lines[0]?.name).toBe('Line 1');

    const nextDocument = createEmptySystem();
    nextDocument.lines = [
      {
        id: 'existing-line',
        name: 'Line 1',
        color: '#000000',
        serviceIds: [],
      },
    ];
    store.commands.document.setSystem(nextDocument);
    store.commands.ways.beginWay('road', 'straight');

    expect(store.getState().system.lines.map((line) => line.name)).toEqual(['Line 1', 'Line 2']);
  });

  it('applies a profile preset as one undoable content commit', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [
      {
        id: 'way',
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
    ];
    store.commands.document.setSystem(system);

    store.commands.ways.applyProfilePreset('way', 'roadArterial4');
    expect(store.getState().system.ways[0].classId).toBe('arterial');

    store.commands.history.undo();
    expect(store.getState().system).toBe(system);
    expect(store.getState().canUndo).toBe(false);
  });

  it('nests checkpoints into one entry and caps history at one hundred snapshots', () => {
    const store = createEditorStore();
    const beforeCheckpoint = store.getState().system;

    store.commands.history.beginHistoryCheckpoint();
    store.commands.document.setName('Outer');
    store.commands.history.beginHistoryCheckpoint();
    store.commands.document.setName('Inner');
    store.commands.history.commitHistoryCheckpoint();
    expect(store.getState().canUndo).toBe(false);
    store.commands.history.commitHistoryCheckpoint();

    store.commands.history.undo();
    expect(store.getState().system).toBe(beforeCheckpoint);
    expect(store.getState().canUndo).toBe(false);

    for (let index = 0; index <= 100; index++) {
      store.commands.document.setName(`Document ${index}`);
    }
    for (let index = 0; index < 100; index++) store.commands.history.undo();

    expect(store.getState().system.name).toBe('Document 0');
    expect(store.getState().canUndo).toBe(false);
  });

  it('keeps viewport persistence outside content undo and redo', () => {
    const store = createEditorStore();
    const viewport = { center: [-115.14, 36.17] as [number, number], zoom: 13 };

    store.commands.document.setName('First');
    store.commands.document.setViewport(viewport);
    store.commands.document.setName('Second');
    store.commands.history.undo();

    expect(store.getState().system.name).toBe('First');
    expect(store.getState().system.viewport).toBe(viewport);
    store.commands.history.redo();
    expect(store.getState().system.name).toBe('Second');
    expect(store.getState().system.viewport).toBe(viewport);
  });

  it('does not turn viewport-only checkpoints into history entries', () => {
    const store = createEditorStore();
    const viewport = { center: [-115.12, 36.2] as [number, number], zoom: 14 };

    store.commands.history.beginHistoryCheckpoint();
    store.commands.document.setViewport(viewport);
    store.commands.history.commitHistoryCheckpoint();

    expect(store.getState().system.viewport).toBe(viewport);
    expect(store.getState().canUndo).toBe(false);

    const laterViewport = { center: [-115.1, 36.22] as [number, number], zoom: 15 };
    store.commands.history.beginHistoryCheckpoint();
    store.commands.document.setViewport(laterViewport);
    store.commands.history.cancelHistoryCheckpoint();

    expect(store.getState().system.viewport).toBe(laterViewport);
    expect(store.getState().canUndo).toBe(false);
  });

  it('gates every content command group while loading before returning phantom results', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createEditorStore({ documentStatus: 'loading' });
    const system = store.getState().system;

    store.commands.document.setName('Blocked');
    store.commands.document.setViewport({ center: [-115, 36], zoom: 12 });
    store.commands.tools.addPaletteColor('#123456');
    store.commands.selection.addMultiSelection([{ kind: 'stop', id: 'stop' }]);
    store.commands.selection.deleteMultiSelection();

    expect(store.commands.ways.beginWay('road', 'straight')).toBeNull();
    store.commands.network.setDrivingSide('left');
    store.commands.imports.importGtfs({ ways: [], lines: [], services: [], stops: [] });
    expect(store.commands.routing.createRoutedService([])).toBeNull();
    expect(store.commands.services.addServiceToWay('way')).toBeNull();
    expect(store.commands.stops.addStop([-115.14, 36.1])).toBeNull();
    expect(store.commands.facilities.addFacility('entrance', [-115.14, 36.1])).toBeNull();
    expect(store.commands.groups.createGroup([])).toBeNull();

    store.commands.tools.setTool('stop');
    expect(store.getState().tool).toBe('stop');
    expect(store.getState().multiSelection).toEqual([{ kind: 'stop', id: 'stop' }]);
    expect(store.getState().activeWayId).toBeNull();
    expect(store.getState().system).toBe(system);
  });
});
