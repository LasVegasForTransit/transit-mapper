// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingDialog } from '../../src/ui/onboarding/OnboardingDialog';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';

interface MockModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

vi.mock('../../src/ui/Modal', () => ({
  Modal: ({ title, onClose, children, footer }: MockModalProps) => (
    <section aria-label={title}>
      <h2>{title}</h2>
      <button type="button" aria-label="Close" onClick={onClose}>
        Close
      </button>
      {children}
      {footer}
    </section>
  ),
}));

vi.mock('../../src/ui/onboarding/OnboardingPreviewMap', () => ({
  OnboardingPreviewMap: ({
    view,
    animateVehicle,
  }: {
    view: ViewOptions;
    animateVehicle?: boolean;
  }) => (
    <div
      data-testid="onboarding-preview"
      data-view-mode={view.viewMode}
      data-shows-services={view.visibleModes.size > 0 ? 'true' : 'false'}
      data-animates-vehicle={animateVehicle ? 'true' : 'false'}
    />
  ),
}));

let container: HTMLDivElement;
let root: Root;

function clickButton(label: string): void {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`Expected a "${label}" button`);
  act(() => button.click());
}

function stepButton(step: number): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[aria-label^="Go to slide ${step}:"]`);
  if (!button) throw new Error(`Expected a button for slide ${step}`);
  return button;
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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('OnboardingDialog', () => {
  it('welcomes a newcomer before explaining the editor', () => {
    act(() => root.render(<OnboardingDialog onClose={vi.fn()} onComplete={vi.fn()} />));

    expect(container.querySelector('h2')?.textContent).toBe('Welcome to TransitMapper');
    expect(container.textContent).toContain(
      'TransitMapper helps you turn an idea for better transit into a map you can explore and refine.',
    );
    expect(container.querySelector('.onboarding-note')?.textContent).toContain('Open beta');
    expect(container.textContent).not.toContain('One system, three views');
  });

  it('moves forward and back through the introduction', () => {
    act(() => root.render(<OnboardingDialog onClose={vi.fn()} onComplete={vi.fn()} />));

    expect(
      [...container.querySelectorAll('button')].some((button) => button.textContent === 'Back'),
    ).toBe(false);
    clickButton('Next');

    expect(container.querySelector('h2')?.textContent).toBe(
      'Sketch the routes your community needs',
    );
    clickButton('Back');

    expect(container.querySelector('h2')?.textContent).toBe('Welcome to TransitMapper');
  });

  it('treats the slide indicators as keyboard-navigable tabs', () => {
    act(() => root.render(<OnboardingDialog onClose={vi.fn()} onComplete={vi.fn()} />));

    const first = stepButton(1);
    first.focus();
    act(() => {
      first.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    });

    expect(container.querySelector('h2')?.textContent).toBe(
      'Sketch the routes your community needs',
    );
    expect(document.activeElement).toBe(stepButton(2));

    act(() => {
      stepButton(2).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    });
    expect(container.querySelector('h2')?.textContent).toBe('See the same system three ways');
    expect(document.activeElement).toBe(stepButton(4));
  });

  it('dismisses without completion and completes only from Start drawing', () => {
    const onClose = vi.fn();
    const onComplete = vi.fn();
    act(() => root.render(<OnboardingDialog onClose={onClose} onComplete={onComplete} />));

    expect(container.textContent).not.toContain('Skip');
    clickButton('Close');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();

    act(() => stepButton(4).click());
    clickButton('Start drawing');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('uses a different visual treatment for each teaching step', () => {
    act(() => root.render(<OnboardingDialog onClose={vi.fn()} onComplete={vi.fn()} />));

    const preview = () =>
      container.querySelector<HTMLElement>('[data-testid="onboarding-preview"]');

    expect(preview()?.dataset.viewMode).toBe('network');
    expect(preview()?.dataset.animatesVehicle).toBe('false');

    clickButton('Next');
    expect(preview()?.dataset.viewMode).toBe('network');
    expect(preview()?.dataset.animatesVehicle).toBe('true');

    clickButton('Next');
    expect(preview()?.dataset.viewMode).toBe('infrastructure');
    expect(preview()?.dataset.showsServices).toBe('false');

    clickButton('Next');
    expect(
      [...container.querySelectorAll('.onboarding-preview-label')].map(
        (label) => label.textContent,
      ),
    ).toEqual(['Infrastructure', 'Network', 'Diagram']);
  });
});
