import { describe, expect, it } from 'vitest';
import { aRoad, aSystem } from '@transitmapper/core/testing/fixtures';
import { selectionFocus } from '../../src/map/selectionFocus';

describe('selectionFocus', () => {
  it('frames every segment represented by a grouped infrastructure selection', () => {
    const west = aRoad('west', [
      [-115.2, 36.1],
      [-115.15, 36.1],
    ]);
    const east = aRoad('east', [
      [-115.15, 36.1],
      [-115.1, 36.1],
    ]);
    const focus = selectionFocus(aSystem({ ways: [west, east] }), {
      kind: 'way',
      id: west.id,
      relatedIds: [west.id, east.id],
    });

    expect(focus?.bounds).toEqual([
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
  });
});
