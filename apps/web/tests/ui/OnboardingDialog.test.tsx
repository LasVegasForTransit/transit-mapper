// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingDialog } from '../../src/ui/onboarding/OnboardingDialog';
import { ONBOARDING_SLIDES } from '../../src/ui/onboarding/slides';

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

interface MockPreviewMapProps {
  scene: string;
  description: string;
}

vi.mock('../../src/ui/onboarding/OnboardingPreviewMap', () => ({
  OnboardingPreviewMap: ({ scene, description }: MockPreviewMapProps) => (
    <div role="img" aria-label={description} data-scene={scene} />
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

function expectSelectedStep(step: number): void {
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs.length).toBeGreaterThanOrEqual(step);
  expect(tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true')).toEqual([
    tabs[step - 1],
  ]);
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
  it('introduces the product before teaching its four capabilities', () => {
    const slides = ONBOARDING_SLIDES as Array<{
      outcome?: string;
      scene?: string;
      visualDescription?: string;
    }>;

    expect(slides.map((slide) => slide.outcome)).toEqual([
      'purpose',
      'service',
      'infrastructure',
      'operations',
      'simulation',
    ]);
    expect(slides.map((slide) => slide.scene)).toEqual([
      'welcome',
      'draw',
      'infrastructure',
      'operations',
      'simulate',
    ]);
    expect(slides.every((slide) => (slide.visualDescription?.length ?? 0) > 0)).toBe(true);
  });

  it('moves forward and back through the introduction', () => {
    act(() => root.render(<OnboardingDialog onClose={vi.fn()} onComplete={vi.fn()} />));

    expectSelectedStep(1);
    expect(container.textContent).toContain('1 of 5');
    expect(container.textContent).toContain('Welcome to TransitMapper');
    expect(container.textContent).toContain(
      'TransitMapper is a tool for imagining, designing, and testing public transit systems on a real map.',
    );
    expect(container.querySelector('.onboarding-copy')?.textContent).toBe(
      'TransitMapper is a tool for imagining, designing, and testing public transit systems on a real map. Start with a place and design the transit system you want to see there.',
    );
    expect(container.querySelector('.onboarding-invitation')).toBeNull();
    expect(container.querySelector('[data-scene="welcome"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Open beta');
    expect(container.querySelector('.onboarding-note')).toBeNull();
    expect(
      [...container.querySelectorAll('button')].some((button) => button.textContent === 'Back'),
    ).toBe(false);
    clickButton('See how it works');

    expectSelectedStep(2);
    expect(container.textContent).toContain('Draw a line. TransitMapper finds the path.');
    expect(container.querySelector('[data-scene="draw"]')).not.toBeNull();
    clickButton('Back');

    expectSelectedStep(1);
  });

  it('treats the slide indicators as keyboard-navigable tabs', () => {
    act(() => root.render(<OnboardingDialog onClose={vi.fn()} onComplete={vi.fn()} />));

    const first = stepButton(1);
    const panel = container.querySelector<HTMLElement>('[role="tabpanel"]');
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expectSelectedStep(1);
    expect(first.id).not.toBe('');
    expect(first.getAttribute('aria-controls')).toBe(panel?.id);
    expect(tabs.every((tab) => tab.getAttribute('aria-controls') === panel?.id)).toBe(true);
    expect(panel?.getAttribute('aria-labelledby')).toBe(first.id);

    first.focus();
    act(() => {
      first.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    });

    expectSelectedStep(2);
    expect(document.activeElement).toBe(stepButton(2));

    act(() => {
      stepButton(2).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    });
    expectSelectedStep(5);
    expect(document.activeElement).toBe(stepButton(5));
  });

  it('dismisses without completing', () => {
    const onClose = vi.fn();
    const onComplete = vi.fn();
    act(() => root.render(<OnboardingDialog onClose={onClose} onComplete={onComplete} />));

    clickButton('Close');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('explains future land-use simulation in the normal slide copy', () => {
    act(() => root.render(<OnboardingDialog onClose={vi.fn()} onComplete={vi.fn()} />));

    act(() => stepButton(5).click());
    expect(container.textContent).toContain(
      'Future versions will also let you explore how transit and land use shape each other.',
    );
    expect(container.querySelector('.onboarding-note')).toBeNull();
  });

  it('completes from the final action', () => {
    const onComplete = vi.fn();
    act(() => root.render(<OnboardingDialog onClose={vi.fn()} onComplete={onComplete} />));

    act(() => stepButton(5).click());
    clickButton('Draw your first service');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
