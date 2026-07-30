// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '../../src/ui/Modal';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
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
});
