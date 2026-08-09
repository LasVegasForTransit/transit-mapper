// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DropdownMenu, DropdownMenuItem } from '../../src/ui/DropdownMenu';
import { Popover } from '../../src/ui/Popover';

const CSS = readFileSync(resolve(process.cwd(), 'src/ui/app.css'), 'utf8')
  // jsdom cannot resolve Vite's CSS imports, and neither import participates
  // in the pointer-event rules this test exercises.
  .replace(/^@import[^;]+;\s*/gm, '');

let container: HTMLDivElement;
let root: Root;
let style: HTMLStyleElement;

function render(node: ReactNode): void {
  act(() => root.render(node));
}

function trigger(label: string): HTMLButtonElement {
  const button = container.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Expected ${label} trigger`);
  return button;
}

function pointerDown(button: HTMLButtonElement): void {
  act(() => {
    button.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
    );
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  style.remove();
});

describe('floating surfaces', () => {
  it('leaves a closed menu trigger clickable', () => {
    render(
      <DropdownMenu trigger={<button aria-label="Actions">Actions</button>}>
        <DropdownMenuItem onSelect={() => undefined}>Export</DropdownMenuItem>
      </DropdownMenu>,
    );

    const button = trigger('Actions');
    expect(button.dataset.state).toBe('closed');
    expect(getComputedStyle(button).pointerEvents).not.toBe('none');

    pointerDown(button);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('opens a menu from its keyboard trigger', () => {
    render(
      <DropdownMenu trigger={<button aria-label="Actions">Actions</button>}>
        <DropdownMenuItem onSelect={() => undefined}>Export</DropdownMenuItem>
      </DropdownMenu>,
    );

    act(() => {
      trigger('Actions').dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }),
      );
    });

    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('gives every shared popover an explicitly scoped surface', () => {
    render(
      <Popover trigger={<button aria-label="Layers">Layers</button>}>
        <span>Layer visibility</span>
      </Popover>,
    );

    const button = trigger('Layers');
    expect(button.dataset.state).toBe('closed');
    expect(getComputedStyle(button).pointerEvents).not.toBe('none');

    act(() => button.click());
    expect(document.querySelector('.popover-content[data-state="open"]')).not.toBeNull();
  });

  it('opens a popover from its keyboard-generated click', () => {
    render(
      <Popover trigger={<button aria-label="Layers">Layers</button>}>
        <span>Layer visibility</span>
      </Popover>,
    );

    const button = trigger('Layers');
    act(() => {
      button.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }),
      );
      button.dispatchEvent(
        new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }),
      );
      // Browsers follow Enter on a native button with a click whose detail is
      // zero. jsdom does not synthesize that default action, so model it here.
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    });

    expect(document.querySelector('.popover-content[data-state="open"]')).not.toBeNull();
  });

  it.each([
    ['dropdown menu', 'dropdown-menu-content'],
    ['popover', 'popover-content'],
    ['modal backdrop', 'modal-backdrop'],
    ['modal', 'modal'],
  ])('stops a closing %s from intercepting taps', (_name, className) => {
    const surface = document.createElement('div');
    surface.className = className;
    surface.dataset.state = 'closed';
    document.body.append(surface);

    expect(getComputedStyle(surface).pointerEvents).toBe('none');
    surface.remove();
  });

  it('stops a closing inspector and its panel from intercepting taps', () => {
    const inspector = document.createElement('div');
    inspector.dataset.inspectorState = 'closed';
    const panel = document.createElement('div');
    panel.className = 'panel-right';
    inspector.append(panel);
    document.body.append(inspector);

    expect(getComputedStyle(inspector).pointerEvents).toBe('none');
    expect(getComputedStyle(panel).pointerEvents).toBe('none');
    inspector.remove();
  });
});
