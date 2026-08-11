// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimControlsPresentation } from '../../src/ui/SimControls';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SimControlsPresentation', () => {
  it('renders the production transport, speed ladder, and formatted clock from explicit state', () => {
    const onTogglePaused = vi.fn();
    const onSpeedChange = vi.fn();
    act(() =>
      root.render(
        <SimControlsPresentation
          paused={false}
          speedId="4x"
          simMs={8 * 60 * 60_000 + 35 * 60_000}
          onTogglePaused={onTogglePaused}
          onSpeedChange={onSpeedChange}
          readOnly={false}
        />,
      ),
    );

    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Simulation',
    );
    expect(container.querySelector('[aria-label="Pause the simulation (K)"]')).not.toBeNull();
    expect(container.querySelector('[aria-label^="4×"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(container.querySelector('.sim-clock')?.textContent).toMatch(/08:35|8:35 AM/);

    act(() => container.querySelector<HTMLButtonElement>('[aria-label^="2×"]')?.click());
    expect(onSpeedChange).toHaveBeenCalledWith('2x');
  });

  it('keeps the passive rendering visually faithful while removing its actions', () => {
    const onSpeedChange = vi.fn();
    act(() =>
      root.render(
        <SimControlsPresentation
          paused={false}
          speedId="4x"
          simMs={8 * 60 * 60_000}
          onTogglePaused={vi.fn()}
          onSpeedChange={onSpeedChange}
          readOnly
        />,
      ),
    );

    const speed = container.querySelector<HTMLButtonElement>('[aria-label^="2×"]');
    act(() => speed?.click());
    expect(onSpeedChange).not.toHaveBeenCalled();
    expect(speed?.disabled).toBe(false);
    expect(speed?.tabIndex).toBe(-1);
  });
});
