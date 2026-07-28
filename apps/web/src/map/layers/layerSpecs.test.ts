import { describe, expect, it } from 'vitest';
import { LYR_SERVICES_HIT } from './constants';
import { LAYER_SPECS } from './layerSpecs';

describe('service occurrence hit layer', () => {
  it('uses the same per-feature offset as the painted bundled line', () => {
    const layer = LAYER_SPECS.find((candidate) => candidate.id === LYR_SERVICES_HIT);

    expect(layer?.type).toBe('line');
    if (!layer || layer.type !== 'line') throw new Error('service hit layer is missing');
    expect(layer?.paint?.['line-offset']).toEqual(['get', 'offset']);
  });
});
