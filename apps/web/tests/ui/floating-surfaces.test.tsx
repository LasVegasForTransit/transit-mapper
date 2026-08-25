// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DropdownMenu, DropdownMenuItem, DropdownMenuLink } from '../../src/ui/DropdownMenu';
import { Popover } from '../../src/ui/Popover';

const CSS = readFileSync(resolve(process.cwd(), 'src/ui/app.css'), 'utf8')
  // jsdom cannot resolve Vite's CSS imports, and neither import participates
  // in the pointer-event rules this test exercises.
  .replace(/^@import[^;]+;\s*/gm, '');

let container: HTMLDivElement;
let root: Root;
let style: HTMLStyleElement;
let originalHidePopover: PropertyDescriptor | undefined;
let originalShowPopover: PropertyDescriptor | undefined;

function render(node: ReactNode): void {
  act(() => root.render(node));
}

function trigger(label: string): HTMLButtonElement {
  const button = container.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Expected ${label} trigger`);
  return button;
}

function activate(button: HTMLButtonElement): void {
  act(() => button.click());
}

function installPopoverMethod(name: 'hidePopover' | 'showPopover', open: boolean): void {
  Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    value: function updatePopoverState(this: HTMLElement): void {
      this.toggleAttribute('data-test-popover-open', open);
    },
  });
}

function restorePopoverMethod(
  name: 'hidePopover' | 'showPopover',
  descriptor?: PropertyDescriptor,
): void {
  if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, name);
}

function ControlledPopover() {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={<button aria-label="Palette">Palette</button>}
    >
      <button type="button" onClick={() => setOpen(false)}>
        Pick red
      </button>
    </Popover>
  );
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
  originalHidePopover = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidePopover');
  originalShowPopover = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover');
  installPopoverMethod('hidePopover', false);
  installPopoverMethod('showPopover', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  style.remove();
  restorePopoverMethod('hidePopover', originalHidePopover);
  restorePopoverMethod('showPopover', originalShowPopover);
});

describe('floating surfaces', () => {
  it('caps centered application notices without blocking the map around them', () => {
    const wrapper = document.createElement('div');
    wrapper.style.pointerEvents = 'none';
    const content = document.createElement('div');
    content.className = 'app-banner-content';
    wrapper.append(content);
    document.body.append(wrapper);

    expect(getComputedStyle(wrapper).pointerEvents).toBe('none');
    expect(getComputedStyle(content).pointerEvents).toBe('auto');
    expect(getComputedStyle(content).maxWidth).toBe('560px');
    wrapper.remove();
  });

  it('leaves a closed menu trigger clickable', () => {
    render(
      <DropdownMenu trigger={<button aria-label="Actions">Actions</button>}>
        <DropdownMenuItem onSelect={() => undefined}>Export</DropdownMenuItem>
      </DropdownMenu>,
    );

    const button = trigger('Actions');
    expect(button.dataset.state).toBe('closed');
    expect(getComputedStyle(button).pointerEvents).not.toBe('none');

    activate(button);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('opens a menu from its keyboard trigger', () => {
    render(
      <DropdownMenu trigger={<button aria-label="Actions">Actions</button>}>
        <DropdownMenuItem onSelect={() => undefined}>Export</DropdownMenuItem>
      </DropdownMenu>,
    );

    act(() => {
      const button = trigger('Actions');
      button.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }),
      );
      button.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    });

    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('opens a menu through the trigger click activation', () => {
    render(
      <DropdownMenu trigger={<button aria-label="Actions">Actions</button>}>
        <DropdownMenuItem onSelect={() => undefined}>Export</DropdownMenuItem>
      </DropdownMenu>,
    );

    act(() => trigger('Actions').click());

    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('opens a menu at its last item from ArrowUp', () => {
    render(
      <DropdownMenu trigger={<button aria-label="Actions">Actions</button>}>
        <DropdownMenuItem onSelect={() => undefined}>Export</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => undefined}>Settings</DropdownMenuItem>
      </DropdownMenu>,
    );

    act(() => {
      trigger('Actions').dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }),
      );
    });

    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.activeElement?.textContent).toContain('Settings');
  });

  it('uses the native auto-popover top layer for a menu', () => {
    render(
      <DropdownMenu trigger={<button aria-label="Actions">Actions</button>}>
        <DropdownMenuItem onSelect={() => undefined}>Export</DropdownMenuItem>
      </DropdownMenu>,
    );

    activate(trigger('Actions'));
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu?.getAttribute('popover')).toBe('auto');
    expect(menu?.hasAttribute('data-test-popover-open')).toBe(true);
    expect(trigger('Actions').getAttribute('aria-expanded')).toBe('true');
  });

  it('provides wrapping arrow-key focus and typeahead in menus', () => {
    render(
      <DropdownMenu trigger={<button aria-label="Actions">Actions</button>}>
        <DropdownMenuItem onSelect={() => undefined}>Export</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => undefined}>Share</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => undefined}>Settings</DropdownMenuItem>
      </DropdownMenu>,
    );

    activate(trigger('Actions'));
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    if (!menu) throw new Error('Expected menu');
    expect(document.activeElement?.textContent).toContain('Export');

    act(() => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    });
    expect(document.activeElement?.textContent).toContain('Settings');

    act(() => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 's' }));
    });
    expect(document.activeElement?.textContent).toContain('Share');

    act(() => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 's' }));
    });
    expect(document.activeElement?.textContent).toContain('Settings');
  });

  it('uses radio semantics for choices and restores focus after selection', () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu trigger={<button aria-label="View">View</button>}>
        <DropdownMenuItem checked onSelect={onSelect}>
          Map
        </DropdownMenuItem>
        <DropdownMenuItem checked={false} onSelect={() => undefined}>
          Diagram
        </DropdownMenuItem>
      </DropdownMenu>,
    );
    const button = trigger('View');
    activate(button);
    const choice = document.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    expect(choice?.getAttribute('aria-checked')).toBe('true');
    if (!choice) throw new Error('Expected menu choice');

    act(() => choice.click());

    expect(onSelect).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('includes links in pointer-driven roving focus', () => {
    render(
      <DropdownMenu trigger={<button aria-label="Actions">Actions</button>}>
        <DropdownMenuItem onSelect={() => undefined}>Export</DropdownMenuItem>
        <DropdownMenuLink href="/privacy">Privacy</DropdownMenuLink>
      </DropdownMenu>,
    );
    activate(trigger('Actions'));
    const link = document.querySelector<HTMLAnchorElement>('a[role="menuitem"]');
    if (!link) throw new Error('Expected menu link');

    act(() => {
      link.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    });

    expect(document.activeElement).toBe(link);
    expect(link.tabIndex).toBe(0);
  });

  it('accepts native light dismissal and leaves outside focus in place', () => {
    render(
      <DropdownMenu trigger={<button aria-label="Actions">Actions</button>}>
        <DropdownMenuItem onSelect={() => undefined}>Export</DropdownMenuItem>
      </DropdownMenu>,
    );
    activate(trigger('Actions'));
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    if (!menu) throw new Error('Expected menu');
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    const toggle = new Event('toggle');
    Object.defineProperty(toggle, 'newState', { value: 'closed' });

    act(() => {
      menu.dispatchEvent(toggle);
    });

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
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

  it('uses a native auto popover and returns focus after controlled dismissal', () => {
    render(<ControlledPopover />);
    const button = trigger('Palette');
    act(() => button.click());
    const surface = document.querySelector<HTMLElement>('.popover-content');
    expect(surface?.getAttribute('popover')).toBe('auto');
    expect(surface?.hasAttribute('data-test-popover-open')).toBe(true);

    const choice = surface?.querySelector<HTMLButtonElement>('button');
    if (!choice) throw new Error('Expected popover choice');
    choice.focus();
    act(() => choice.click());

    expect(document.querySelector('.popover-content')).toBeNull();
    expect(document.activeElement).toBe(button);
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
