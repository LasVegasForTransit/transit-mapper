import { describe, expect, it } from 'vitest';
import { parseOsmElementsPayload } from '../../src/model/import';

describe('parseOsmElementsPayload', () => {
  it('rejects malformed nested geometry, node, tag, and relation-member values', () => {
    const malformed = [
      { type: 'way', id: 1, geometry: [null] },
      { type: 'way', id: 2, nodes: [1, 'two'] },
      { type: 'way', id: 3, tags: { highway: 42 } },
      { type: 'relation', id: 4, members: [{ type: 'way', ref: 'five', role: 'from' }] },
    ];

    for (const element of malformed) {
      expect(() => parseOsmElementsPayload([element])).toThrow('Invalid OpenStreetMap response.');
    }
  });

  it('rejects out-of-range coordinates and invalid OpenStreetMap identities', () => {
    const malformed = [
      { type: 'way', id: 10, geometry: [{ lat: 91, lon: -115 }] },
      { type: 'mystery', id: 10 },
      { type: 'way', id: 10.5 },
      { type: 'way', id: 11, nodes: [-1] },
    ];

    for (const element of malformed) {
      expect(() => parseOsmElementsPayload([element])).toThrow('Invalid OpenStreetMap response.');
    }
  });
});
