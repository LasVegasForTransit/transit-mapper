// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShortcutsDialog } from '../../src/ui/ShortcutsDialog';

describe('ShortcutsDialog', () => {
  beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
  afterEach(() => vi.unstubAllGlobals());

  it('lists simulation shortcuts while the simulation owns their keyboard lifetime', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    act(() => root.render(<ShortcutsDialog onClose={vi.fn()} />));

    expect(host.textContent).toContain('Run / pause the simulation');
    expect(host.textContent).toContain('Slow the simulation down');
    expect(host.textContent).toContain('Speed the simulation up');

    act(() => root.unmount());
    host.remove();
  });
});
