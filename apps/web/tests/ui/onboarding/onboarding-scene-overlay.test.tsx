// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OnboardingSceneOverlay } from '../../../src/ui/onboarding/onboarding-scene-overlay';

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

describe('OnboardingSceneOverlay', () => {
  it('connects service settings to an operating requirement', () => {
    act(() =>
      root.render(
        <OnboardingSceneOverlay
          scene="operations"
          failed={false}
          description="Crosstown splits into two branches."
          clockLabel="6:00 AM"
        />,
      ),
    );

    expect(container.textContent).toContain('Crosstown');
    expect(container.textContent).toContain('Every 10 min');
    expect(container.textContent).toContain('6 AM–11 PM');
    expect(container.textContent).toContain('Eastgate');
    expect(container.textContent).toContain('Airport');
    expect(container.textContent).toMatch(/\d+ vehicles required/);
  });

  it('contrasts imported infrastructure with the one proposed rail link', () => {
    act(() =>
      root.render(
        <OnboardingSceneOverlay
          scene="infrastructure"
          failed={false}
          description="The proposal reuses Port Mason infrastructure."
          clockLabel="6:00 AM"
        />,
      ),
    );

    expect(container.textContent).toContain('Imported streets + freight track');
    expect(container.textContent).toContain('New downtown rail link');
  });

  it('shows the simulated time as part of the operating consequence', () => {
    act(() =>
      root.render(
        <OnboardingSceneOverlay
          scene="simulate"
          failed={false}
          description="Vehicles move through Port Mason."
          clockLabel="8:35 AM"
        />,
      ),
    );

    expect(container.textContent).toContain('System running');
    expect(container.textContent).toContain('8:35 AM');
    expect(container.textContent).toContain('Every 10 min');
  });

  it('keeps the scene explanation and key values when the map fails', () => {
    const description = 'Crosstown follows existing streets across the river bridge.';
    act(() =>
      root.render(
        <OnboardingSceneOverlay
          scene="draw"
          failed
          description={description}
          clockLabel="6:00 AM"
        />,
      ),
    );

    expect(container.textContent).toContain(description);
    expect(container.textContent).toContain('Crosstown');
    expect(container.textContent).toContain('Harbor Line');
    expect(container.textContent).not.toContain('Error');
  });
});
