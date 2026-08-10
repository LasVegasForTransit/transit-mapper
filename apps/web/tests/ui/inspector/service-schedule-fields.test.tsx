// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceScheduleFields } from '../../../src/ui/inspector/service-schedule-fields';

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

describe('ServiceScheduleFields', () => {
  it('renders a read-only service with the same schedule controls as the inspector', () => {
    act(() =>
      root.render(
        <ServiceScheduleFields
          frequencyMinutes={10}
          spanStart="06:00"
          spanEnd="23:00"
          readOnly
          onFrequencyChange={vi.fn()}
          onSpanChange={vi.fn()}
          onOpenFullSchedule={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain('Peak headway');
    expect(container.textContent).toContain('Span of service');
    expect(container.textContent).toContain('Daytime');
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('10 min');
    expect(
      [...container.querySelectorAll('button[aria-pressed="true"]')].map(
        (button) => button.textContent,
      ),
    ).toEqual(['10 min', 'Daytime']);
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    expect(container.textContent).not.toContain('Use a full schedule instead');
  });

  it('passes an edited preset back to the live inspector', () => {
    const onFrequencyChange = vi.fn();
    act(() =>
      root.render(
        <ServiceScheduleFields
          frequencyMinutes={10}
          spanStart="06:00"
          spanEnd="23:00"
          readOnly={false}
          onFrequencyChange={onFrequencyChange}
          onSpanChange={vi.fn()}
          onOpenFullSchedule={vi.fn()}
        />,
      ),
    );

    const fifteenMinutes = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '15 min',
    );
    if (!fifteenMinutes) throw new Error('Expected the 15 minute preset');
    act(() => fifteenMinutes.click());

    expect(onFrequencyChange).toHaveBeenCalledWith(15);
  });
});
