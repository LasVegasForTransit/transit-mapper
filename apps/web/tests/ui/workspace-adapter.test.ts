import { describe, expect, it } from 'vitest';
import { representationLabel, supplementalDetent } from '../../src/ui/workspace-adapter';

describe('the editor workspace adapter', () => {
  it('uses the current representation as user-facing sheet text', () => {
    expect(representationLabel('network')).toBe('Network');
    expect(representationLabel('infrastructure')).toBe('Infrastructure');
    expect(representationLabel('diagram')).toBe('Diagram');
  });

  it('opens a selection halfway without covering the map', () => {
    expect(supplementalDetent({ kind: 'selection' })).toBe('half');
  });

  it('keeps tool options closed because the tool acts on the map', () => {
    expect(supplementalDetent({ kind: 'tool-draft', tool: 'way' })).toBe('closed');
  });

  it('does not move a sheet when supplemental content is absent', () => {
    expect(supplementalDetent({ kind: 'none' })).toBeNull();
  });
});
