import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { aRoad, aService } from '@transitmapper/core/testing/fixtures';
import {
  createDocumentCommands,
  createHistoryCommands,
} from '../../../src/editor/store/commands/document-commands';
import { createSelectionCommands } from '../../../src/editor/store/commands/selection-commands';
import { createToolCommands } from '../../../src/editor/store/commands/tool-commands';
import { createEditorRuntime } from '../../../src/editor/store/runtime';
import { describe, expect, it } from 'vitest';

const finishingOperations = {
  createId: () => 'generated',
};

describe('editor command factories', () => {
  it('builds stable document and history commands around one runtime', () => {
    const runtime = createEditorRuntime();
    const document = createDocumentCommands(runtime);
    const history = createHistoryCommands(runtime);
    const system = createEmptySystem();

    document.setSystem(system);

    expect(runtime.read().system).toBe(system);
    expect(history.undo).toBe(runtime.history.undo);
  });

  it('finishes an active way before changing tools and narrows a lines selection', () => {
    const runtime = createEditorRuntime();
    const tools = createToolCommands(runtime, finishingOperations);
    const service = aService('parent', []);
    const way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    runtime.installDocument(
      {
        ...createEmptySystem(),
        lines: [{ id: 'line', name: 'Line 1', color: '#123456', serviceIds: [service.id] }],
        services: [service],
        ways: [way],
      },
      { tool: 'select' },
    );
    runtime.updateTransient({
      selection: { kind: 'way', id: 'way' },
      multiSelection: [
        { kind: 'way', id: 'way' },
        { kind: 'line', id: 'line' },
      ],
      activeWayId: 'way',
      addingServiceDraft: { lineId: 'line', name: 'Branch', modeId: 'bus' },
    });
    let writes = 0;
    runtime.subscribe(() => writes++);

    tools.setTool('lines');

    expect(writes).toBe(1);
    expect(runtime.read().activeWayId).toBeNull();
    expect(runtime.read().selection).toBeNull();
    expect(runtime.read().multiSelection).toEqual([{ kind: 'line', id: 'line' }]);
    expect(runtime.read().system.lines[0]?.serviceIds).toEqual(['parent', 'generated']);
    expect(runtime.read().system.services[1]?.path.id).toBe('generated');
  });

  it('allows transient tool and selection changes while loading but blocks their content edits', () => {
    const system = {
      ...createEmptySystem(),
      stops: [{ id: 'stop', coord: [0, 0] as [number, number], anchors: [] }],
    };
    const runtime = createEditorRuntime({ documentStatus: 'loading', initialSystem: system });
    const tools = createToolCommands(runtime, finishingOperations);
    const selection = createSelectionCommands(runtime);

    tools.setTool('stop');
    selection.select({ kind: 'stop', id: 'stop' });
    selection.addMultiSelection([{ kind: 'stop', id: 'stop' }]);
    tools.addPaletteColor('#123456');
    selection.deleteMultiSelection();

    expect(runtime.read().tool).toBe('stop');
    expect(runtime.read().multiSelection).toEqual([{ kind: 'stop', id: 'stop' }]);
    expect(runtime.read().system).toBe(system);
  });
});
