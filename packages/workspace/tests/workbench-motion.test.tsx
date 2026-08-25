// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbench } from '../src/index';

let container: HTMLDivElement;
let root: Root;
let animationFrames: FrameRequestCallback[];

function renderWorkbench(chromeHidden: boolean): void {
  const slot = (name: string) => <span>{name}</span>;
  act(() =>
    root.render(
      <div data-zen={chromeHidden || undefined}>
        <Workbench
          slots={{
            brand: slot('brand'),
            primaryActions: slot('primary'),
            representationControls: slot('representation'),
            compactRepresentationControls: slot('compact-representation'),
            simulationControls: slot('simulation'),
            compactSimulationControls: slot('compact-simulation'),
            mainPanel: slot('main'),
            supplementalPanel: null,
            toolDock: slot('tools'),
          }}
          state={{
            representationLabel: 'Network',
            hasSupplementalContent: false,
            initialSupplementalDetent: null,
            chromeHidden,
            contentStatus: 'ready',
          }}
          actions={{ onToggleInterface: () => {}, onDismissSupplemental: () => {} }}
        />
      </div>,
    ),
  );
}

function flushAnimationFrame(): void {
  const callbacks = animationFrames;
  animationFrames = [];
  act(() => callbacks.forEach((callback) => callback(performance.now())));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
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
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!this.classList.contains('menu-card')) return DOMRect.fromRect();
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
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Workbench chrome motion', () => {
  it('paints both width endpoints before animating the menu card', () => {
    renderWorkbench(false);
    const card = container.querySelector<HTMLElement>('.menu-card');
    renderWorkbench(true);
    expect(card?.style.width).toBe('280px');
    flushAnimationFrame();
    expect(card?.style.width).toBe('280px');
    flushAnimationFrame();
    expect(card?.style.width).toBe('242px');

    renderWorkbench(false);
    expect(card?.style.width).toBe('242px');
    flushAnimationFrame();
    flushAnimationFrame();
    expect(card?.style.width).toBe('280px');
  });
});
