// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbench } from '../src/index';

const STEP_WIDTH: Record<string, number> = {
  full: 480,
  labels: 390,
  tertiary: 310,
  overflow: 180,
};

let container: HTMLDivElement;
let root: Root;
let slotWidth: number;
let extraBarWidth: number;
let observed: { target: Element; notify: () => void }[];

function reportResize(target: Element): void {
  act(() => observed.filter((entry) => entry.target === target).forEach((entry) => entry.notify()));
}

function renderAt(width: number): HTMLElement {
  slotWidth = width;
  const slot = (name: string) => <span>{name}</span>;
  act(() =>
    root.render(
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
          chromeHidden: false,
          contentStatus: 'ready',
        }}
        actions={{ onToggleInterface: () => {}, onDismissSupplemental: () => {} }}
      />,
    ),
  );
  const bar = container.querySelector('.actions-full');
  if (!(bar instanceof HTMLElement)) throw new Error('Expected the desktop action bar');
  return bar;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  observed = [];
  extraBarWidth = 0;
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
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
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
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('desktop toolbar fitting', () => {
  it('selects the widest fit that its container can hold', () => {
    const bar = renderAt(520);
    const box = bar.parentElement;
    if (!box) throw new Error('Expected the action bar container');
    expect(bar.dataset.fit).toBe('full');

    for (const [width, fit] of [
      [400, 'labels'],
      [330, 'tertiary'],
      [200, 'overflow'],
    ] as const) {
      slotWidth = width;
      reportResize(box);
      expect(bar.dataset.fit).toBe(fit);
    }
  });

  it('reserves the overflow fit as the minimum width', () => {
    expect(renderAt(40).parentElement?.style.minWidth).toBe(`${STEP_WIDTH.overflow}px`);
  });

  it('steps down when the bar content grows without a container resize', () => {
    const bar = renderAt(520);
    expect(bar.dataset.fit).toBe('full');
    extraBarWidth = 60;
    reportResize(bar);
    expect(bar.dataset.fit).toBe('labels');
  });
});
