// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import { EditorProvider } from '../../../src/editor/EditorProvider';
import { createEditorStore, type EditorStore } from '../../../src/editor/store';
import { ServiceInspector } from '../../../src/ui/inspector/ServiceInspector';

let container: HTMLDivElement;
let root: Root;
let store: EditorStore;
let patternId: string;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const road = aRoad('road', [
    [-115.2, 36.1],
    [-115.19, 36.1],
  ]);
  const service = aService('service', [aPattern('pattern', [road], [road.id])]);
  patternId = service.path.id;
  store = createEditorStore();
  store.commands.document.setSystem(aSystem({ ways: [road], services: [service] }));
  store.commands.selection.select({ kind: 'service', id: service.id });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Service path editing', () => {
  it('closes an opened Path when the person leaves the Path task', () => {
    act(() => {
      root.render(
        <EditorProvider store={store}>
          <ServiceInspector id="service" />
        </EditorProvider>,
      );
    });
    const pathTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent === 'Path',
    );
    if (!pathTab) throw new Error('Expected a Path tab.');
    act(() => pathTab.click());
    const editPath = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Edit path'),
    );
    if (!editPath) throw new Error('Expected an Edit path action.');
    act(() => editPath.click());

    expect(store.getState().activePatternId).toBe(patternId);

    const serviceTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent === 'Service',
    );
    if (!serviceTab) throw new Error('Expected a Service tab.');
    act(() => serviceTab.click());

    expect(store.getState().activePatternId).toBeNull();
  });
});
