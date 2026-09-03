// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '../../src/ui/Modal';

let container: HTMLDivElement;
let root: Root;
let originalClose: PropertyDescriptor | undefined;
let originalShowModal: PropertyDescriptor | undefined;

function restoreDialogMethod(name: 'close' | 'showModal', descriptor?: PropertyDescriptor): void {
  if (descriptor) {
    Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    return;
  }
  Reflect.deleteProperty(HTMLDialogElement.prototype, name);
}

function finishClosing(_dialog: HTMLDialogElement): void {
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function showModal(this: HTMLDialogElement): void {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function close(this: HTMLDialogElement): void {
      this.removeAttribute('open');
    },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  restoreDialogMethod('close', originalClose);
  restoreDialogMethod('showModal', originalShowModal);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Modal', () => {
  it('uses the shared icon button for its close action', () => {
    act(() =>
      root.render(
        <Modal title="Example" description="An example dialog" onClose={vi.fn()}>
          Content
        </Modal>,
      ),
    );

    const close = document.querySelector<HTMLButtonElement>(
      '.modal-head button[aria-label="Close"]',
    );
    expect(close).not.toBeNull();
    expect(close?.classList.contains('btn')).toBe(true);
    expect(close?.classList.contains('icon-only')).toBe(true);
  });

  it('opens a native modal dialog with labelled context', () => {
    act(() =>
      root.render(
        <Modal title="Example" description="An example dialog" onClose={vi.fn()}>
          Content
        </Modal>,
      ),
    );

    const dialog = document.querySelector<HTMLDialogElement>('dialog.modal');
    expect(dialog?.open).toBe(true);
    expect(dialog?.getAttribute('aria-labelledby')).toBe(
      dialog?.querySelector('h2')?.getAttribute('id'),
    );
    expect(dialog?.getAttribute('aria-describedby')).toBe(
      dialog?.querySelector('.sr-only')?.getAttribute('id'),
    );
  });

  it('keeps Escape dismissal mounted through the closing motion', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    act(() =>
      root.render(
        <Modal title="Example" description="An example dialog" onClose={onClose}>
          Content
        </Modal>,
      ),
    );
    const dialog = document.querySelector<HTMLDialogElement>('dialog.modal');
    if (!dialog) throw new Error('Expected native dialog');

    const cancel = new Event('cancel', { bubbles: true, cancelable: true });
    act(() => {
      dialog.dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.dataset.state).toBe('closed');
    expect(onClose).not.toHaveBeenCalled();

    finishClosing(dialog);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('dismisses an outside backdrop press but not a press inside the dialog', () => {
    const onClose = vi.fn();
    act(() =>
      root.render(
        <Modal title="Example" description="An example dialog" onClose={onClose}>
          Content
        </Modal>,
      ),
    );
    const dialog = document.querySelector<HTMLDialogElement>('dialog.modal');
    if (!dialog) throw new Error('Expected native dialog');
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      top: 100,
      right: 300,
      bottom: 300,
      left: 100,
      width: 200,
      height: 200,
      toJSON: () => ({}),
    });

    act(
      () =>
        void dialog.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, clientX: 150, clientY: 150 }),
        ),
    );
    expect(dialog.dataset.state).toBe('open');

    act(
      () =>
        void dialog.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 40 }),
        ),
    );
    expect(dialog.dataset.state).toBe('closed');
  });

  it('returns focus to the opener after the close animation', () => {
    vi.useFakeTimers();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    act(() =>
      root.render(
        <Modal title="Example" description="An example dialog" onClose={vi.fn()}>
          Content
        </Modal>,
      ),
    );
    const dialog = document.querySelector<HTMLDialogElement>('dialog.modal');
    const close = dialog?.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    if (!dialog || !close) throw new Error('Expected native dialog with close action');
    close.focus();

    act(() => close.click());
    finishClosing(dialog);

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
