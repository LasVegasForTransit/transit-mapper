// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { SidebarSectionBoundary } from '../../src/ui/SidebarPanel';

describe('SidebarSectionBoundary', () => {
  it('isolates a failed section and lets the user retry it', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldFail = true;
    function FragileSection() {
      if (shouldFail) throw new Error('projection failed');
      return <p>Recovered Lines</p>;
    }

    act(() => {
      root.render(
        <SidebarSectionBoundary label="Lines">
          <FragileSection />
        </SidebarSectionBoundary>,
      );
    });
    expect(container.textContent).toContain('Lines couldn’t be shown');

    const retry = container.querySelector('button');
    if (!retry) throw new Error('Expected a retry button');
    shouldFail = false;
    act(() => retry.click());
    expect(container.textContent).toContain('Recovered Lines');

    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
  });
});
