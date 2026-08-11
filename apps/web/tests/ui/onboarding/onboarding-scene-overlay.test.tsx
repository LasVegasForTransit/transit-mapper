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
  it('uses the production Schedule presentation for operations', () => {
    act(() =>
      root.render(
        <OnboardingSceneOverlay
          scene="operations"
          failed={false}
          description="Crosstown splits into two branches."
        />,
      ),
    );

    expect(container.querySelector<HTMLInputElement>('[aria-label="Service name"]')?.value).toBe(
      'Charleston Crosstown',
    );
    const inspector = container.querySelector('.onboarding-service-inspector-preview');
    expect(inspector?.tagName).toBe('ASIDE');
    expect(inspector?.classList.contains('panel')).toBe(true);
    expect(inspector?.classList.contains('panel-right')).toBe(true);
    expect(inspector?.hasAttribute('inert')).toBe(false);
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].every(
        (tab) => tab.disabled,
      ),
    ).toBe(true);
    expect(container.textContent).toContain('Schedule');
    expect(container.textContent).toContain('Frequency · peak headway');
    expect(container.textContent).toContain('10 min');
    expect(container.textContent).toContain('Service hours · span of service');
    expect(container.textContent).toContain('Daytime');
    expect(container.textContent).toContain('Round trip');
    expect(container.textContent).toContain('Vehicles');
    expect(container.textContent).toContain('time at stops');
    expect(container.textContent).toContain('running that often');
    expect(container.textContent).not.toContain('dwell');
    expect(container.textContent).not.toContain('Service plan');
  });

  it('leaves the infrastructure scene map-only', () => {
    act(() =>
      root.render(
        <OnboardingSceneOverlay
          scene="infrastructure"
          failed={false}
          description="The proposal reuses central Las Vegas infrastructure."
        />,
      ),
    );

    expect(container.textContent).toBe('');
    expect(container.textContent).not.toContain('Infrastructure');
    expect(container.textContent).not.toContain('Imported streets + freight track');
    expect(container.textContent).not.toContain('New downtown rail link');
  });

  it('uses the production simulation presentation in the running 4× state', () => {
    act(() =>
      root.render(
        <OnboardingSceneOverlay
          scene="simulate"
          failed={false}
          description="Vehicles move through central Las Vegas."
        />,
      ),
    );

    expect(container.querySelector('.sim-controls')?.getAttribute('aria-label')).toBe('Simulation');
    expect(container.querySelector('[aria-label="Pause the simulation (K)"]')).not.toBeNull();
    expect(container.querySelector('[aria-label^="4×"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(container.querySelector('.sim-clock')?.textContent).not.toBe('');
  });

  it('uses only the scene explanation when the map fails', () => {
    const description = 'Crosstown follows existing streets across the river bridge.';
    act(() =>
      root.render(<OnboardingSceneOverlay scene="draw" failed description={description} />),
    );

    expect(container.textContent).toBe(description);
    expect(container.textContent).not.toContain('Error');
    expect(container.textContent).not.toContain('Network · Bus');
    expect(container.textContent).not.toContain('Every 10 min');
  });
});
