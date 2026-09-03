import { describe, expect, it } from 'vitest';
import { transitEntityKey, type TransitEntityRef } from '../../src/model/transit-entity-ref';

const entityKindSet = {
  publisher: true,
  agency: true,
  operator: true,
  alignment: true,
  way: true,
  line: true,
  'service-plan': true,
  pattern: true,
  schedule: true,
  calendar: true,
  trip: true,
  'frequency-rule': true,
  'operational-change': true,
  advisory: true,
  stop: true,
  station: true,
  facility: true,
  group: true,
  node: true,
  'named-way': true,
  median: true,
  'lane-connector': true,
  'turn-restriction': true,
  'approach-control': true,
} satisfies Record<TransitEntityRef['kind'], true>;

const entityKinds = Object.keys(entityKindSet) as TransitEntityRef['kind'][];

describe('transit entity references', () => {
  it('gives every entity kind a stable distinct key', () => {
    const keys = entityKinds.map((kind) => transitEntityKey({ kind, id: 'shared-id' }));

    expect(new Set(keys).size).toBe(entityKinds.length);
    expect(transitEntityKey({ kind: 'line', id: 'blue:east' })).toBe('domain:line:blue%3Aeast');
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
