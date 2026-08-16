// @vitest-environment jsdom

import { act, type ComponentType } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StagedMapCanvas } from '../../src/map/staged-map';

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
});

describe('the staged editor map', () => {
  it('commits a truthful map shell before it begins loading MapLibre', async () => {
    let resolveMap: ((value: { default: ComponentType }) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<{ default: ComponentType }>((resolvePromise) => {
          resolveMap = resolvePromise;
        }),
    );

    flushSync(() => root.render(<StagedMapCanvas load={load} />));

    expect(container.querySelector('[data-map-shell="loading"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Preparing map');
    expect(load).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledOnce();

    await act(async () => {
      resolveMap?.({ default: () => <div data-map-shell="ready" /> });
      await Promise.resolve();
    });
    expect(container.querySelector('[data-map-shell="ready"]')).not.toBeNull();
  });
});
