import { describe, expect, it } from 'vitest';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import { patternPositionAt } from '@transitmapper/core/model/serviceEdits';
import { createEditorStore } from '../../src/editor/store';
import { clearArmedTerminusForViewChange } from '../../src/map/viewEditorState';

describe('view-owned editor state', () => {
  it('clears an armed return when the editor view changes', () => {
    const road = aRoad('road', [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ]);
    const pattern = aPattern('branch', [road], ['road']);
    const position = patternPositionAt([road], pattern, 'outbound', 0, 1);
    if (!position) throw new Error('The fixture must have an end position.');
    const store = createEditorStore();
    store.commands.document.setSystem(
      aSystem({ ways: [road], services: [aService('bus', [pattern])] }),
    );
    store.commands.selection.armTerminus({
      serviceId: 'bus',
      patternId: 'branch',
      side: 'end',
      position,
    });

    clearArmedTerminusForViewChange(store);

    expect(store.getState().armedTerminus).toBeNull();
  });
});
