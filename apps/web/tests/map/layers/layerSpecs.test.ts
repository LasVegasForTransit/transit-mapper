import { describe, expect, it } from 'vitest';
import {
  LYR_CONNECTORS,
  LYR_JUNCTION_GUIDES,
  LYR_SERVICES_HIT,
  SRC_CONNECTORS,
  SRC_HIT_FEATURES,
  SRC_JUNCTION_GUIDES,
} from '../../../src/map/layers/constants';
import { LAYER_SPECS } from '../../../src/map/layers/layerSpecs';
import { ALL_SYSTEM_FEATURE_SOURCES } from '../../../src/map/sourceUploadPlan';

describe('service occurrence hit layer', () => {
  it('uses the same per-feature offset as the painted bundled line', () => {
    const layer = LAYER_SPECS.find((candidate) => candidate.id === LYR_SERVICES_HIT);

    expect(layer?.type).toBe('line');
    if (layer?.type !== 'line') throw new Error('service hit layer is missing');
    expect(layer.source).toBe(SRC_HIT_FEATURES);
    expect(layer.paint?.['line-offset']).toEqual(['get', 'offset']);
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

  it('keeps selected-junction guides on a transient source above renderer connectors', () => {
    const rendererConnectors = LAYER_SPECS.find((candidate) => candidate.id === LYR_CONNECTORS);
    const selectedGuides = LAYER_SPECS.find((candidate) => candidate.id === LYR_JUNCTION_GUIDES);
    const rendererIndex = LAYER_SPECS.findIndex((layer) => layer.id === LYR_CONNECTORS);
    const guideIndex = LAYER_SPECS.findIndex((layer) => layer.id === LYR_JUNCTION_GUIDES);

    if (rendererConnectors?.type !== 'line') throw new Error('renderer connector layer is missing');
    if (selectedGuides?.type !== 'line') throw new Error('junction guide layer is missing');
    expect(rendererConnectors.source).toBe(SRC_CONNECTORS);
    expect(SRC_JUNCTION_GUIDES).toBe('tm-junction-guides');
    expect(selectedGuides.source).toBe(SRC_JUNCTION_GUIDES);
    expect(guideIndex).toBeGreaterThan(rendererIndex);
    expect(ALL_SYSTEM_FEATURE_SOURCES).toContain(SRC_CONNECTORS);
    expect(ALL_SYSTEM_FEATURE_SOURCES).not.toContain(SRC_JUNCTION_GUIDES);
  });
});
