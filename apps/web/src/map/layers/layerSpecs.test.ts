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

  it('service termini paint above service and corridor lines for hit priority', () => {
    const terminus = LAYER_SPECS.findIndex((layer) => layer.id === 'tm-service-termini');
    const service = LAYER_SPECS.findIndex((layer) => layer.id === LYR_SERVICES_HIT);
    const corridor = LAYER_SPECS.findIndex((layer) => layer.id === 'tm-ways-solid');

    expect(terminus).toBeGreaterThan(service);
    expect(terminus).toBeGreaterThan(corridor);
  });

  it('the action anchor paints above the line it resolves', () => {
    const anchor = LAYER_SPECS.findIndex((layer) => layer.id === 'tm-action-anchor');
    const service = LAYER_SPECS.findIndex((layer) => layer.id === LYR_SERVICES_HIT);

    expect(anchor).toBeGreaterThan(service);
  });
});
