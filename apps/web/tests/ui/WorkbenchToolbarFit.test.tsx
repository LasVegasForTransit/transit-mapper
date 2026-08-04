// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider } from '../../src/editor/EditorProvider';
import { UiProvider } from '../../src/ui/UiProvider';
import { Workbench } from '../../src/ui/Workbench';

/** What each `[data-fit]` step costs. app.css decides this for real by hiding
 *  content; jsdom has no layout, so the widths are declared here and the test
 *  checks only the choice made between them. */
const STEP_WIDTH: Record<string, number> = {
  full: 480,
  labels: 390,
  tertiary: 310,
  overflow: 180,
};

let container: HTMLDivElement;
let root: Root | undefined;
let slotWidth: number;

function renderWorkbench(): void {
  const slot = (name: string) => <span>{name}</span>;
  if (!root) throw new Error('Expected a React root');
  const currentRoot = root;
  act(() => {
    currentRoot.render(
      <EditorProvider>
        <UiProvider>
          <Workbench
            brand={slot('brand')}
            menuPanel={slot('menu')}
            supplementalPanel={null}
            hasSupplementalContent={false}
            primaryToolbar={slot('primary')}
            viewSwitcher={slot('view')}
            simControls={slot('desktop-sim')}
            simControlsCompact={slot('mobile-sim')}
            modeToolbar={slot('mode')}
          />
        </UiProvider>
      </EditorProvider>,
    );
  });
}

function actionBar(): HTMLElement {
  const bar = container.querySelector('.actions-full');
  if (!(bar instanceof HTMLElement)) throw new Error('Expected the desktop action bar');
  return bar;
}

function renderAt(width: number): HTMLElement {
  slotWidth = width;
  renderWorkbench();
  return actionBar();
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: globalThis.matchMedia,
  });

  // useToolbarFit prices a step by writing data-fit and measuring; stand in
  // for the layout jsdom does not do.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!this.classList.contains('actions-full')) return DOMRect.fromRect();
    return DOMRect.fromRect({ width: STEP_WIDTH[this.dataset.fit ?? 'full'] });
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.querySelector(':scope > .actions-full') ? slotWidth : 0;
    },
  });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  const currentRoot = root;
  root = undefined;
  if (currentRoot) act(() => currentRoot.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the desktop action bar sizes itself to its container', () => {
  it('shows everything when its container is wider than the full bar', () => {
    expect(renderAt(520).dataset.fit).toBe('full');
  });

  it('drops the button labels first', () => {
    expect(renderAt(400).dataset.fit).toBe('labels');
  });

  it('drops the help actions once dropping labels is not enough', () => {
    expect(renderAt(330).dataset.fit).toBe('tertiary');
  });

  it('hands the secondary actions to the overflow menu when nothing else fits', () => {
    expect(renderAt(200).dataset.fit).toBe('overflow');
  });

  it('stops at the smallest step rather than reporting a size that does not fit', () => {
    expect(renderAt(40).dataset.fit).toBe('overflow');
  });

  it('reserves the smallest step on its container so the row cannot squeeze it away', () => {
    const slot = renderAt(40).parentElement;
    expect(slot?.style.minWidth).toBe(`${STEP_WIDTH.overflow}px`);
  });
});
