import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorProvider } from '../../src/editor/EditorProvider';
import {
  Inspector,
  supplementalContentFor,
  supplementalOpensSheet,
  type SupplementalInput,
} from '../../src/ui/Inspector';
import { ViewProvider } from '../../src/ui/ViewProvider';

function content(overrides: Partial<SupplementalInput> = {}) {
  return supplementalContentFor({
    tool: 'select',
    readOnly: false,
    viewMode: 'network',
    hasSelection: false,
    ...overrides,
  });
}

describe('what the supplemental panel shows', () => {
  it('offers Select its modifier channels, whatever the pointer', () => {
    // These are the only way to reach Erase, Constrain, and Split without
    // holding a key, and nothing about them is gated on the pointer. They used
    // to be hidden wherever a pointer could hover, which meant a touchscreen
    // laptop — a device reporting BOTH `hover: hover` and `pointer: coarse` —
    // could not reach those operations by finger at all.
    expect(content({ tool: 'select' })).toEqual({
      kind: 'tool-draft',
      tool: 'select',
      standing: true,
    });
  });

  it('marks Select’s options standing, so they never take over the sheet', () => {
    // They are present from load. Auto-expanding for them parked the mobile
    // sheet over most of the map before anyone had touched anything.
    expect(supplementalOpensSheet(content({ tool: 'select' }))).toBe(false);
  });

  it('lets an armed drawing tool take over the sheet', () => {
    const armed = content({ tool: 'way' });
    expect(armed).toEqual({ kind: 'tool-draft', tool: 'way', standing: false });
    expect(supplementalOpensSheet(armed)).toBe(true);
  });

  it('gives a drawing tool priority over a stale selection', () => {
    expect(content({ tool: 'station', hasSelection: true }).kind).toBe('tool-draft');
  });

  it('gives a selection priority over Select’s standing options', () => {
    // What you just picked is more specific than how the next press will be
    // qualified — the one place a tool draft yields.
    const selected = content({ tool: 'select', hasSelection: true });
    expect(selected).toEqual({ kind: 'selection' });
    expect(supplementalOpensSheet(selected)).toBe(true);
  });

  it('offers no tool options where nothing is editable', () => {
    // Diagram is a projection and a shared system is immutable, so an armed
    // tool from before switching there must not still claim the panel.
    expect(content({ tool: 'way', viewMode: 'diagram' })).toEqual({ kind: 'none' });
    expect(content({ tool: 'way', readOnly: true })).toEqual({ kind: 'none' });
    expect(content({ tool: 'select', readOnly: true, hasSelection: true })).toEqual({
      kind: 'selection',
    });
  });
});

describe('the modifier channels', () => {
  it('names each key in the accessible label, keyboard or not', () => {
    // Hover is not a proxy for having a keyboard: an iPad with a keyboard case
    // reports none and has one. Omitting the key here hid the shortcut from a
    // screen reader on exactly the devices that could use it. Whether the key
    // is DRAWN is a separate question, answered by app.css.
    const markup = renderToStaticMarkup(
      <EditorProvider>
        <ViewProvider initialViewMode="network">
          <Inspector />
        </ViewProvider>
      </EditorProvider>,
    );

    expect(markup).toContain('Erase (Alt).');
    expect(markup).toContain('Constrain (Shift).');
    expect(markup).toContain('Split / extend (Ctrl).');
    expect(markup).toContain('class="chip-key"');
  });
});
