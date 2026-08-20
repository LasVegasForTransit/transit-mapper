// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingPreviewMap } from '../../../src/ui/onboarding/OnboardingPreviewMap';

const controllerHarness = vi.hoisted(() => ({
  dispose: vi.fn(),
  failNextMount: false,
  mountOnboardingMap: vi.fn((options: { onFailure: (error: unknown) => void }) => {
    if (controllerHarness.failNextMount) {
      controllerHarness.failNextMount = false;
      options.onFailure(new Error('WebGL unavailable'));
    }
    return {
      dispose: controllerHarness.dispose,
      setScene: controllerHarness.setScene,
    };
  }),
  setScene: vi.fn(),
}));

vi.mock('../../../src/theme/systemColorScheme', () => ({
  useSystemColorScheme: () => 'dark',
}));

vi.mock('../../../src/ui/onboarding/onboarding-map-controller', () => ({
  mountOnboardingMap: controllerHarness.mountOnboardingMap,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false }),
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  controllerHarness.dispose.mockClear();
  controllerHarness.setScene.mockClear();
  controllerHarness.mountOnboardingMap.mockClear();
  controllerHarness.failNextMount = false;
});

describe('OnboardingPreviewMap', () => {
  it('reuses one map controller while every onboarding scene changes', () => {
    const description = 'A local Las Vegas transit preview.';

    act(() => root.render(<OnboardingPreviewMap scene="welcome" description={description} />));
    for (const scene of ['draw', 'infrastructure', 'operations', 'simulate'] as const) {
      act(() => root.render(<OnboardingPreviewMap scene={scene} description={description} />));
    }

    expect(controllerHarness.mountOnboardingMap).toHaveBeenCalledTimes(1);
    expect(controllerHarness.setScene).toHaveBeenNthCalledWith(1, 'welcome');
    expect(controllerHarness.setScene).toHaveBeenNthCalledWith(2, 'draw');
    expect(controllerHarness.setScene).toHaveBeenNthCalledWith(3, 'infrastructure');
    expect(controllerHarness.setScene).toHaveBeenNthCalledWith(4, 'operations');
    expect(controllerHarness.setScene).toHaveBeenNthCalledWith(5, 'simulate');
    expect(controllerHarness.dispose).not.toHaveBeenCalled();

    act(() => root.unmount());
    expect(controllerHarness.dispose).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it('replaces a failed map with the accessible proposal summary', () => {
    const description = 'Charleston Crosstown follows existing streets in central Las Vegas.';

    controllerHarness.failNextMount = true;

    act(() => root.render(<OnboardingPreviewMap scene="draw" description={description} />));

    expect(container.querySelector('.onboarding-preview-map')).toBeNull();
    expect(container.textContent).toBe(description);
    expect(container.textContent).not.toContain('Harbor Line');
  });
});
