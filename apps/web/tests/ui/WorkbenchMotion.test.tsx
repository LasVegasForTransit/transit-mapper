// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider } from '../../src/editor/EditorProvider';
import { UiProvider, useUi } from '../../src/ui/UiProvider';
import { Workbench } from '../../src/ui/Workbench';

let container: HTMLDivElement;
let root: Root | undefined;
let animationFrames: FrameRequestCallback[];

function ChromeHarness({ children }: { children: ReactNode }) {
  const { toggleUi, uiHidden } = useUi();
  return (
    <div data-zen={uiHidden || undefined}>
      <button type="button" onClick={toggleUi}>
        Toggle UI
      </button>
      {children}
    </div>
  );
}

function renderWorkbench(): void {
  const slot = (name: string) => <span>{name}</span>;
  if (!root) throw new Error('Expected a React root');
  const currentRoot = root;
  act(() => {
    currentRoot.render(
      <EditorProvider>
        <UiProvider>
          <ChromeHarness>
            <Workbench
              brand={slot('brand')}
              menuPanel={slot('menu')}
              supplementalPanel={null}
              hasSupplementalContent={false}
              supplementalIsFresh={false}
              primaryToolbar={slot('primary')}
              viewSwitcher={slot('view')}
              simControls={slot('desktop-sim')}
              simControlsCompact={slot('mobile-sim')}
              modeToolbar={slot('mode')}
            />
          </ChromeHarness>
        </UiProvider>
      </EditorProvider>,
    );
  });
}

function toggleUi(): void {
  const button = container.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('Expected the UI toggle');
  act(() => button.click());
}

function flushAnimationFrame(): void {
  const callbacks = animationFrames;
  animationFrames = [];
  act(() => callbacks.forEach((callback) => callback(performance.now())));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  animationFrames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
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
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!this.classList.contains('menu-card')) {
      return DOMRect.fromRect();
    }
    const inlineWidth = Number.parseFloat(this.style.width);
    const hidden = this.closest('[data-zen]')?.getAttribute('data-zen') === 'true';
    const width =
      this.style.width === 'auto' || Number.isNaN(inlineWidth) ? (hidden ? 242 : 280) : inlineWidth;
    return DOMRect.fromRect({ width });
  });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Workbench chrome motion', () => {
  it('paints both width endpoints before animating the menu card between them', () => {
    renderWorkbench();
    const card = container.querySelector<HTMLElement>('.menu-card');
    expect(card).not.toBeNull();

    toggleUi();
    expect(card?.style.width).toBe('280px');
    flushAnimationFrame();
    expect(card?.style.width).toBe('280px');
    flushAnimationFrame();
    expect(card?.style.width).toBe('242px');

    toggleUi();
    expect(card?.style.width).toBe('242px');
    flushAnimationFrame();
    expect(card?.style.width).toBe('242px');
    flushAnimationFrame();
    expect(card?.style.width).toBe('280px');
  });
});
