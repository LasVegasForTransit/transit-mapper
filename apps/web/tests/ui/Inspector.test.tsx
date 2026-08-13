import { describe, expect, it } from 'vitest';
import { supplementalContentFor, type SupplementalInput } from '../../src/ui/Inspector';

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
  it('shows nothing for the Select tool on its own', () => {
    // Select has no options of its own. Erasing and splitting are variants on
    // its dock button, where every other tool's variants live — an inspector
    // that never closes would be chrome with nothing to say.
    expect(content({ tool: 'select' })).toEqual({ kind: 'none' });
  });

  it('shows an armed drawing tool its own options', () => {
    expect(content({ tool: 'way' })).toEqual({ kind: 'tool-draft', tool: 'way' });
  });

  it('gives a drawing tool priority over a stale selection', () => {
    // What you are doing right now outranks what you clicked before you picked
    // the tool up.
    expect(content({ tool: 'stop', hasSelection: true }).kind).toBe('tool-draft');
  });

  it('shows a selection when Select is armed', () => {
    expect(content({ tool: 'select', hasSelection: true })).toEqual({ kind: 'selection' });
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
