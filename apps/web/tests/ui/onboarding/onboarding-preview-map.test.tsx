// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingPreviewMap } from '../../../src/ui/onboarding/OnboardingPreviewMap';

const cleanup = vi.fn();

vi.mock('../../../src/theme/systemColorScheme', () => ({
  useSystemColorScheme: () => 'dark',
}));

vi.mock('../../../src/ui/onboarding/onboarding-map-controller', () => ({
  mountOnboardingMap: (options: { onFailure: (error: unknown) => void }) => {
    options.onFailure(new Error('WebGL unavailable'));
    return cleanup;
  },
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
  cleanup.mockClear();
});

describe('OnboardingPreviewMap', () => {
  it('replaces a failed map with the accessible proposal summary', () => {
    const description = 'Charleston Crosstown follows existing streets in central Las Vegas.';

    act(() => root.render(<OnboardingPreviewMap scene="draw" description={description} />));

    expect(container.querySelector('.onboarding-preview-map')).toBeNull();
    expect(container.textContent).toBe(description);
    expect(container.textContent).not.toContain('Harbor Line');
  });
});
