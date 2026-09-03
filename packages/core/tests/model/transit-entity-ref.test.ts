import { describe, expect, it } from 'vitest';
import {
  parseTransitEntityRef,
  TRANSIT_ENTITY_KINDS,
  transitEntityKey,
} from '../../src/model/transit-entity-ref';

describe('transit entity references', () => {
  it('gives every entity kind a stable distinct key', () => {
    const keys = TRANSIT_ENTITY_KINDS.map((kind) => transitEntityKey({ kind, id: 'shared-id' }));

    expect(new Set(keys).size).toBe(TRANSIT_ENTITY_KINDS.length);
    expect(transitEntityKey({ kind: 'line', id: 'blue:east' })).toBe('domain:line:blue%3Aeast');
  });

  it('parses only portable entity kinds and preserves their opaque IDs', () => {
    expect(parseTransitEntityRef({ kind: 'line', id: 'blue:east', layerId: 'ignored' })).toEqual({
      kind: 'line',
      id: 'blue:east',
    });
    expect(() => parseTransitEntityRef({ kind: 'vehicle-kind', id: 'bus' })).toThrow();
    expect(() => parseTransitEntityRef({ kind: 'line', id: ' ' })).toThrow();
    expect(() => parseTransitEntityRef(null)).toThrow();
  });

  it('keeps delimiter text distinct from its encoded spelling', () => {
    expect(transitEntityKey({ kind: 'line', id: 'blue:east' })).not.toBe(
      transitEntityKey({ kind: 'line', id: 'blue%3Aeast' }),
    );
  });

  it('rejects blank entity IDs', () => {
    expect(() => transitEntityKey({ kind: 'line', id: '' })).toThrow();
    expect(() => transitEntityKey({ kind: 'line', id: '   ' })).toThrow();
  });
});
