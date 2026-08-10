// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider } from '../../src/editor/EditorProvider';
import { UiProvider } from '../../src/ui/UiProvider';
import { ViewProvider } from '../../src/ui/ViewProvider';
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
/** Stands in for the bar's content changing under a container that has not
 *  moved — a mounting issues badge, or forking a read-only system. */
let extraBarWidth: number;
let observed: { target: Element; notify: () => void }[];

/** Fires only the observers actually watching `target`, the way a real
 *  ResizeObserver would when just that element changes size. */
function reportResize(target: Element): void {
  act(() => observed.filter((entry) => entry.target === target).forEach((entry) => entry.notify()));
}

function renderWorkbench(): void {
  const slot = (name: string) => <span>{name}</span>;
  if (!root) throw new Error('Expected a React root');
  const currentRoot = root;
  act(() => {
    currentRoot.render(
      <EditorProvider>
        <ViewProvider>
          <UiProvider>
            <Workbench
              brand={slot('brand')}
              menuPanel={slot('menu')}
              supplementalPanel={null}
              supplemental="none"
              primaryToolbar={slot('primary')}
              viewSwitcher={slot('view')}
              viewSwitcherCompact={<span data-slot="view-compact" />}
              simControls={slot('desktop-sim')}
              simControlsCompact={slot('mobile-sim')}
              modeToolbar={slot('mode')}
            />
          </UiProvider>
        </ViewProvider>
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

  observed = [];
  extraBarWidth = 0;
  // Records what was observed, not just that something was. A real
  // ResizeObserver only fires for the elements handed to observe(), and the
  // point of one of the cases below is which element that is.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {}
      observe(target: Element): void {
        observed.push({ target, notify: this.callback });
      }
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
    return DOMRect.fromRect({ width: STEP_WIDTH[this.dataset.fit ?? 'full'] + extraBarWidth });
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

  it('steps down when its own content grows and the container has not moved', () => {
    const bar = renderAt(520);
    expect(bar.dataset.fit).toBe('full');

    // A mounting issues badge widens every step. The container is `flex-1`
    // from a zero basis, so its width does not change and nothing reports a
    // resize on it — only the bar itself changed size.
    extraBarWidth = 60;
    reportResize(bar);

    expect(bar.dataset.fit).toBe('labels');
  });
});
